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
import { ChatIndexBackfill } from "../chat-index/backfill.js";

export interface MeetingIndexProgressDTO {
  state: "idle" | "running" | "paused" | "complete" | "error";
  total: number;
  completed: number;
  currentRunFolder: string | null;
  errors: number;
}

const appLogger = createAppLogger(false);

let backfillInstance: ChatIndexBackfill | null = null;
let latestBackfillProgress: MeetingIndexProgressDTO = {
  state: "idle",
  total: 0,
  completed: 0,
  currentRunFolder: null,
  errors: 0,
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
    async (): Promise<MeetingIndexProgressDTO> => {
      const bf = getOrCreateBackfill();
      bf.start().catch((err) => {
        appLogger.warn("backfill failed", {
          detail: err instanceof Error ? err.message : String(err),
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

  ipcMain.handle(
    "meeting-index:embed-model-status",
    async (): Promise<{ model: string; installed: boolean }> => {
      // The wizard calls this *before* config exists. Don't blow up — fall
      // back to "not installed" so the UI can offer to pull the model.
      try {
        const config = loadConfig();
        const models = await listOllamaModels(config.ollama.base_url);
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

  ipcMain.handle("meeting-index:install-embed-model", async (): Promise<void> => {
    const config = loadConfig();
    const broadcast = (channel: string, payload: unknown) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(channel, payload);
      }
    };
    try {
      await pullOllamaModel(DEFAULT_EMBEDDING_MODEL, {
        baseUrl: config.ollama.base_url,
        onLog: (line) => broadcast("setup-llm:log", line),
        onProgress: (progress) => broadcast("setup-llm:progress", progress),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appLogger.warn("meeting-index:install-embed-model failed", { detail: message });
      throw err;
    }
  });
}
