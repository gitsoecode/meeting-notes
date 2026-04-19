import { EventEmitter } from "node:events";
import { createAppLogger, loadConfig } from "@meeting-notes/engine";
import { getDb } from "../db/connection.js";
import { countRunChunks } from "./store.js";
import { indexRun } from "./index-run.js";

const appLogger = createAppLogger(false);

export interface BackfillProgress {
  state: "idle" | "running" | "paused" | "complete" | "error";
  total: number;
  completed: number;
  currentRunFolder: string | null;
  errors: number;
}

export interface BackfillEventMap {
  progress: (p: BackfillProgress) => void;
}

/**
 * Headless state machine: iterates runs, indexes any that lack chat_chunks,
 * emits progress events. Does not own UX. Renderer decides how to surface
 * progress based on meeting count.
 */
export class ChatIndexBackfill extends EventEmitter {
  private progress: BackfillProgress = {
    state: "idle",
    total: 0,
    completed: 0,
    currentRunFolder: null,
    errors: 0,
  };
  private abortController: AbortController | null = null;
  private running = false;

  constructor(
    private readonly embedder:
      | ((inputs: string[]) => Promise<number[][]>)
      | null
  ) {
    super();
  }

  getProgress(): BackfillProgress {
    return { ...this.progress };
  }

  /** Count runs that need indexing. Cheap read. */
  countPending(): number {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT r.run_id
         FROM runs r
         LEFT JOIN (
           SELECT run_id, COUNT(*) AS n
           FROM chat_chunks
           GROUP BY run_id
         ) c ON c.run_id = r.run_id
         WHERE r.status IN ('complete', 'error')
           AND (c.n IS NULL OR c.n = 0)`
      )
      .all() as Array<{ run_id: string }>;
    return rows.length;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.abortController = new AbortController();

    const db = getDb();
    const pending = db
      .prepare(
        `SELECT r.folder_path
         FROM runs r
         LEFT JOIN (
           SELECT run_id, COUNT(*) AS n
           FROM chat_chunks
           GROUP BY run_id
         ) c ON c.run_id = r.run_id
         WHERE r.status IN ('complete', 'error')
           AND (c.n IS NULL OR c.n = 0)
         ORDER BY r.started DESC`
      )
      .all() as Array<{ folder_path: string }>;

    this.progress = {
      state: "running",
      total: pending.length,
      completed: 0,
      currentRunFolder: null,
      errors: 0,
    };
    this.emit("progress", this.getProgress());

    if (pending.length === 0) {
      this.progress.state = "complete";
      this.running = false;
      this.emit("progress", this.getProgress());
      return;
    }

    for (const row of pending) {
      if (this.abortController?.signal.aborted) {
        this.progress.state = "paused";
        break;
      }
      this.progress.currentRunFolder = row.folder_path;
      this.emit("progress", this.getProgress());

      try {
        // If this run has chunks now (e.g. a parallel indexRun wrote them),
        // skip to avoid duplicate work.
        const db2 = getDb();
        const existing = db2
          .prepare("SELECT run_id FROM runs WHERE folder_path = ?")
          .get(row.folder_path) as { run_id: string } | undefined;
        if (existing && countRunChunks(db2, existing.run_id) > 0) {
          this.progress.completed += 1;
          continue;
        }

        await indexRun(row.folder_path, {
          embedder: this.embedder ?? undefined,
        });
        this.progress.completed += 1;
      } catch (err) {
        this.progress.errors += 1;
        appLogger.warn("Backfill chunk index failed", {
          detail: err instanceof Error ? err.message : String(err),
          runFolder: row.folder_path,
        });
      }

      this.emit("progress", this.getProgress());
    }

    this.progress.currentRunFolder = null;
    if (this.progress.state !== "paused") {
      this.progress.state = "complete";
    }
    this.running = false;
    this.abortController = null;
    this.emit("progress", this.getProgress());
  }

  pause(): void {
    if (!this.running) return;
    this.abortController?.abort();
  }
}

/**
 * Convenience: build a backfill instance that uses the configured Ollama
 * daemon + `nomic-embed-text` for embeddings. Callers decide whether to
 * run it; this function doesn't auto-start.
 */
export async function createDefaultBackfill(): Promise<ChatIndexBackfill> {
  const { createOllamaEmbedder, DEFAULT_EMBEDDING_MODEL } = await import(
    "@meeting-notes/engine"
  );
  const config = loadConfig();
  const embedder = createOllamaEmbedder({
    baseUrl: config.ollama.base_url,
    model: DEFAULT_EMBEDDING_MODEL,
  });
  return new ChatIndexBackfill(embedder);
}
