import { EventEmitter } from "node:events";
import { createAppLogger, loadConfig } from "@gistlist/engine";
import { getDb } from "../db/connection.js";
import { isVecAvailable } from "../db/sqlite-vec-loader.js";
import { countRunChunks } from "./store.js";
import { indexRun } from "./index-run.js";

const appLogger = createAppLogger(false);

export type BackfillScope = "missing-chunks" | "missing-embeddings";

export interface BackfillProgress {
  state: "idle" | "running" | "paused" | "complete" | "error";
  total: number;
  completed: number;
  currentRunFolder: string | null;
  errors: number;
  /**
   * Which run set this progress reflects. Lets the renderer attribute
   * `errors` correctly when Settings opens after the run already finished
   * (e.g. distinguishing "Ollama unreachable" from "indexing failed").
   */
  scope: BackfillScope;
}

export interface BackfillStartOptions {
  scope?: BackfillScope;
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
    scope: "missing-chunks",
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

  /** Count runs that have zero `chat_chunks` rows (never indexed). */
  countPending(): number {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM runs r
         LEFT JOIN (
           SELECT run_id, COUNT(*) AS n
           FROM chat_chunks
           GROUP BY run_id
         ) c ON c.run_id = r.run_id
         WHERE r.status IN ('complete', 'error')
           AND (c.n IS NULL OR c.n = 0)`
      )
      .get() as { n: number };
    return row.n;
  }

  /**
   * Count terminal runs that have at least one chunk missing its vec row
   * (FTS-only because Ollama was down at index time, or partial vector
   * loss). Returns 0 when sqlite-vec isn't loaded — there's no useful
   * recovery action in that case.
   */
  countMissingEmbeddings(): number {
    if (!isVecAvailable()) return 0;
    const db = getDb();
    const row = db
      .prepare(
        `SELECT COUNT(DISTINCT c.run_id) AS n
         FROM chat_chunks c
         JOIN runs r ON r.run_id = c.run_id
         WHERE r.status IN ('complete', 'error')
           AND NOT EXISTS (
             SELECT 1 FROM chat_chunks_vec v WHERE v.rowid = c.chunk_id
           )`
      )
      .get() as { n: number };
    return row.n;
  }

  async start(opts: BackfillStartOptions = {}): Promise<void> {
    if (this.running) return;
    const scope: BackfillScope = opts.scope ?? "missing-chunks";
    this.running = true;
    this.abortController = new AbortController();

    try {
      const db = getDb();
      const pending = this.selectRunsForScope(db, scope);

      this.progress = {
        state: "running",
        total: pending.length,
        completed: 0,
        currentRunFolder: null,
        errors: 0,
        scope,
      };
      this.emit("progress", this.getProgress());

      if (pending.length === 0) {
        this.progress.state = "complete";
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
          // For "missing-chunks" only: skip if chunks landed in parallel
          // (another indexRun wrote them). The "missing-embeddings" scope
          // intentionally re-runs even when chunks exist — that's the
          // whole point.
          if (scope === "missing-chunks") {
            const db2 = getDb();
            const existing = db2
              .prepare("SELECT run_id FROM runs WHERE folder_path = ?")
              .get(row.folder_path) as { run_id: string } | undefined;
            if (existing && countRunChunks(db2, existing.run_id) > 0) {
              this.progress.completed += 1;
              continue;
            }
          }

          const result = await indexRun(row.folder_path, {
            embedder: this.embedder ?? undefined,
          });

          // For "missing-embeddings", embedded === false means the
          // embedder failed again (Ollama still down, model still
          // missing) — count as error so the UI can tell the user
          // their fix didn't take.
          if (scope === "missing-embeddings" && !result.embedded) {
            this.progress.errors += 1;
          } else {
            this.progress.completed += 1;
          }
        } catch (err) {
          this.progress.errors += 1;
          appLogger.warn("Backfill chunk index failed", {
            detail: err instanceof Error ? err.message : String(err),
            runFolder: row.folder_path,
            scope,
          });
        }

        this.emit("progress", this.getProgress());
      }

      this.progress.currentRunFolder = null;
      if (this.progress.state !== "paused") {
        this.progress.state = "complete";
      }
      this.emit("progress", this.getProgress());
    } catch (err) {
      // Unexpected failure (DB read, query throw, etc). Surface as error
      // state so the renderer can react instead of staring at a stale
      // "running" forever.
      appLogger.warn("Backfill aborted by unexpected error", {
        detail: err instanceof Error ? err.message : String(err),
        scope,
      });
      this.progress.state = "error";
      this.progress.currentRunFolder = null;
      this.emit("progress", this.getProgress());
    } finally {
      this.running = false;
      this.abortController = null;
    }
  }

  private selectRunsForScope(
    db: ReturnType<typeof getDb>,
    scope: BackfillScope
  ): Array<{ folder_path: string }> {
    if (scope === "missing-chunks") {
      return db
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
    }
    // missing-embeddings: vec extension required
    if (!isVecAvailable()) return [];
    return db
      .prepare(
        `SELECT DISTINCT r.folder_path, r.started
         FROM chat_chunks c
         JOIN runs r ON r.run_id = c.run_id
         WHERE r.status IN ('complete', 'error')
           AND NOT EXISTS (
             SELECT 1 FROM chat_chunks_vec v WHERE v.rowid = c.chunk_id
           )
         ORDER BY r.started DESC`
      )
      .all() as Array<{ folder_path: string }>;
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
    "@gistlist/engine"
  );
  const config = loadConfig();
  const embedder = createOllamaEmbedder({
    baseUrl: config.ollama.base_url,
    model: DEFAULT_EMBEDDING_MODEL,
  });
  return new ChatIndexBackfill(embedder);
}
