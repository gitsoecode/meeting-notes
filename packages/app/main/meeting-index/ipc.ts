/**
 * IPC handlers for the meeting index — the SQLite FTS + sqlite-vec corpus
 * that the MCP server (and future consumers) reads over. The Gistlist app
 * owns writing this index; renderer UI exposes re-index / install-embedder
 * controls in Settings and the Setup Wizard.
 *
 * Originally lived under `chat/ipc.ts` when the in-app Chat surface was
 * the only consumer. The synthesis / threads / guardrails pieces were
 * removed when the in-app chat route was deprecated in favor of Claude
 * Desktop + MCP; these handlers survived because MCP still needs the
 * populated index and the embed model.
 */
import { BrowserWindow } from "electron";
import { ipcMain } from "electron";
import {
  DEFAULT_EMBEDDING_MODEL,
  createAppLogger,
  listOllamaModels,
  loadConfig,
  pullOllamaModel,
  createOllamaEmbedder,
} from "@gistlist/engine";
import { broadcastToAll } from "../events.js";
import { getDb } from "../db/connection.js";
import { isVecAvailable } from "../db/sqlite-vec-loader.js";
import {
  ChatIndexBackfill,
  type BackfillScope,
} from "../chat-index/backfill.js";

export type MeetingIndexBackfillScope = BackfillScope;

export interface MeetingIndexProgressDTO {
  state: "idle" | "running" | "paused" | "complete" | "error";
  total: number;
  completed: number;
  currentRunFolder: string | null;
  errors: number;
  scope: MeetingIndexBackfillScope;
}

export interface MeetingIndexHealthDTO {
  totalRuns: number;
  pendingRuns: number;
  ftsOnlyRuns: number;
  vecAvailable: boolean;
}

const appLogger = createAppLogger(false);

let backfillInstance: ChatIndexBackfill | null = null;
let latestBackfillProgress: MeetingIndexProgressDTO = {
  state: "idle",
  total: 0,
  completed: 0,
  currentRunFolder: null,
  errors: 0,
  scope: "missing-chunks",
};

function getOrCreateBackfill(): ChatIndexBackfill {
  if (backfillInstance) return backfillInstance;
  const config = loadConfig();
  const embedder = createOllamaEmbedder({
    baseUrl: config.ollama.base_url,
    model: DEFAULT_EMBEDDING_MODEL,
  });
  const instance = new ChatIndexBackfill(embedder);
  instance.on("progress", (progress: MeetingIndexProgressDTO) => {
    latestBackfillProgress = progress;
    broadcastToAll("meeting-index:backfill-progress", progress);
  });
  backfillInstance = instance;
  return instance;
}

export function registerMeetingIndexIpc(): void {
  ipcMain.handle(
    "meeting-index:backfill-start",
    async (
      _e,
      arg?: { scope?: MeetingIndexBackfillScope },
    ): Promise<MeetingIndexProgressDTO> => {
      const bf = getOrCreateBackfill();
      const scope: MeetingIndexBackfillScope = arg?.scope ?? "missing-chunks";
      bf.start({ scope }).catch((err) => {
        appLogger.warn("backfill failed", {
          detail: err instanceof Error ? err.message : String(err),
          scope,
        });
      });
      return bf.getProgress();
    },
  );

  ipcMain.handle(
    "meeting-index:backfill-status",
    async (): Promise<MeetingIndexProgressDTO> => {
      if (backfillInstance) return backfillInstance.getProgress();
      return latestBackfillProgress;
    },
  );

  ipcMain.handle("meeting-index:backfill-count-pending", async (): Promise<number> => {
    const bf = getOrCreateBackfill();
    try {
      return bf.countPending();
    } catch {
      return 0;
    }
  });

  // Direct DB read — does NOT route through getOrCreateBackfill(), so
  // opening Settings doesn't spin up an embedder/Ollama client just to
  // count rows.
  ipcMain.handle(
    "meeting-index:health",
    async (): Promise<MeetingIndexHealthDTO> => {
      try {
        const db = getDb();
        const vecAvailable = isVecAvailable();

        const totalRow = db
          .prepare(
            "SELECT COUNT(*) AS n FROM runs WHERE status IN ('complete', 'error')",
          )
          .get() as { n: number };

        const pendingRow = db
          .prepare(
            `SELECT COUNT(*) AS n
             FROM runs r
             LEFT JOIN (
               SELECT run_id, COUNT(*) AS n
               FROM chat_chunks
               GROUP BY run_id
             ) c ON c.run_id = r.run_id
             WHERE r.status IN ('complete', 'error')
               AND (c.n IS NULL OR c.n = 0)`,
          )
          .get() as { n: number };

        let ftsOnlyRuns = 0;
        if (vecAvailable) {
          const ftsRow = db
            .prepare(
              `SELECT COUNT(DISTINCT c.run_id) AS n
               FROM chat_chunks c
               JOIN runs r ON r.run_id = c.run_id
               WHERE r.status IN ('complete', 'error')
                 AND NOT EXISTS (
                   SELECT 1 FROM chat_chunks_vec v WHERE v.rowid = c.chunk_id
                 )`,
            )
            .get() as { n: number };
          ftsOnlyRuns = ftsRow.n;
        }

        return {
          totalRuns: totalRow.n,
          pendingRuns: pendingRow.n,
          ftsOnlyRuns,
          vecAvailable,
        };
      } catch (err) {
        appLogger.warn("meeting-index:health failed", {
          detail: err instanceof Error ? err.message : String(err),
        });
        return {
          totalRuns: 0,
          pendingRuns: 0,
          ftsOnlyRuns: 0,
          vecAvailable: false,
        };
      }
    },
  );

  // Default Ollama base URL — matches the bundled-spawned daemon address
  // and the engine's DEFAULT_CONFIG.ollama.base_url. Used as the fallback
  // when the wizard calls these handlers BEFORE config has been written
  // (fresh first-run install). Without this fallback, `loadConfig()`
  // throws and the user dead-ends on the embed-model row.
  const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";

  // Resolve an Ollama base URL given an optional caller hint. Tries the
  // hint first, then loadConfig (re-run from Settings path), then the
  // default. Never throws — first-run callers can always pull the model.
  const resolveOllamaBaseUrl = (hint?: string): string => {
    if (hint) return hint;
    try {
      return loadConfig().ollama.base_url;
    } catch {
      return DEFAULT_OLLAMA_BASE_URL;
    }
  };

  ipcMain.handle(
    "meeting-index:embed-model-status",
    async (
      _e,
      opts?: { baseUrl?: string },
    ): Promise<{ model: string; installed: boolean }> => {
      // The wizard calls this *before* config exists on a fresh install.
      // Accept an optional `baseUrl` so the caller can drive the lookup
      // without `loadConfig()`. Falls back to config → default daemon
      // URL. Always returns a valid result; never throws.
      try {
        const baseUrl = resolveOllamaBaseUrl(opts?.baseUrl);
        const models = await listOllamaModels(baseUrl);
        const installed = models.some(
          (m) =>
            m.name === DEFAULT_EMBEDDING_MODEL ||
            m.name.startsWith(`${DEFAULT_EMBEDDING_MODEL}:`),
        );
        return { model: DEFAULT_EMBEDDING_MODEL, installed };
      } catch {
        return { model: DEFAULT_EMBEDDING_MODEL, installed: false };
      }
    },
  );

  ipcMain.handle(
    "meeting-index:install-embed-model",
    async (_e, opts?: { baseUrl?: string }): Promise<void> => {
      // Same fresh-install accommodation as the status handler above:
      // the wizard can call this BEFORE `config.initProject()` writes
      // the YAML config to disk. The optional `baseUrl` lets the caller
      // pin the daemon URL; falls back to config / default on rerun
      // paths from Settings.
      const baseUrl = resolveOllamaBaseUrl(opts?.baseUrl);
      const broadcast = (channel: string, payload: unknown) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send(channel, payload);
        }
      };
      try {
        await pullOllamaModel(DEFAULT_EMBEDDING_MODEL, {
          baseUrl,
          onLog: (line) => broadcast("setup-llm:log", line),
          onProgress: (progress) => broadcast("setup-llm:progress", progress),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        appLogger.warn("meeting-index:install-embed-model failed", { detail: message });
        throw err;
      }
    },
  );
}
