import { EventEmitter } from "node:events";
import { ipcMain, BrowserWindow } from "electron";
import {
  DEFAULT_EMBEDDING_MODEL,
  createAppLogger,
  listOllamaModels,
  loadConfig,
  pullOllamaModel,
} from "@meeting-notes/engine";
import type {
  ChatBackfillProgressDTO,
  ChatCitationDTO,
  ChatMessageDTO,
  ChatSendRequest,
  ChatSendResult,
  ChatSettingsDTO,
  ChatStreamEvent,
  ChatThreadDTO,
  ParticipantDTO,
} from "../../shared/ipc.js";
import { getDb } from "../db/connection.js";
import { broadcastToAll } from "../events.js";
import { sendMessage } from "./retrieval-assistant.js";
import {
  DEFAULT_CHAT_SYSTEM_PROMPT,
  readChatSystemPrompt,
  resetChatSystemPrompt,
  writeChatSystemPrompt,
} from "./prompt.js";
import {
  deleteThread as dbDeleteThread,
  getThread as dbGetThread,
  listMessages as dbListMessages,
  listThreads as dbListThreads,
  renameThread as dbRenameThread,
  setThreadModel as dbSetThreadModel,
} from "./threads.js";
import { ChatIndexBackfill } from "../chat-index/backfill.js";
import { createOllamaEmbedder } from "@meeting-notes/engine";

const appLogger = createAppLogger(false);

let backfillInstance: ChatIndexBackfill | null = null;
let latestBackfillProgress: ChatBackfillProgressDTO = {
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
  instance.on("progress", (progress: ChatBackfillProgressDTO) => {
    latestBackfillProgress = progress;
    broadcastToAll("chat:backfill-progress", progress);
  });
  backfillInstance = instance;
  return instance;
}

export function registerChatIpc(): void {
  ipcMain.handle("chat:send", async (_e, req: ChatSendRequest): Promise<ChatSendResult> => {
    const stream = new EventEmitter();
    stream.on("chat-event", (event: ChatStreamEvent) => {
      broadcastToAll("chat:stream", event);
    });
    try {
      const result = await sendMessage(
        {
          threadId: req.threadId,
          userMessage: req.userMessage,
          modelOverride: req.modelOverride,
          filters: req.filters,
        },
        stream,
      );
      return {
        thread_id: result.thread_id,
        user_message_id: result.user_message_id,
        assistant_message_id: result.assistant_message_id,
        content: result.content,
        citations: result.citations as ChatCitationDTO[],
      };
    } catch (err) {
      appLogger.warn("chat:send failed", {
        detail: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  });

  ipcMain.handle("chat:list-threads", async (): Promise<ChatThreadDTO[]> => {
    return dbListThreads();
  });

  ipcMain.handle(
    "chat:get-thread",
    async (_e, threadId: string): Promise<{ thread: ChatThreadDTO; messages: ChatMessageDTO[] } | null> => {
      const thread = dbGetThread(threadId);
      if (!thread) return null;
      const messages = dbListMessages(threadId);
      return {
        thread,
        messages: messages.map((m) => ({
          message_id: m.message_id,
          thread_id: m.thread_id,
          role: m.role,
          content: m.content,
          citations: m.citations as ChatCitationDTO[],
          created_at: m.created_at,
        })),
      };
    }
  );

  ipcMain.handle("chat:rename-thread", async (_e, threadId: string, title: string) => {
    dbRenameThread(threadId, title);
  });

  ipcMain.handle("chat:delete-thread", async (_e, threadId: string) => {
    dbDeleteThread(threadId);
  });

  ipcMain.handle("chat:set-thread-model", async (_e, threadId: string, modelId: string | null) => {
    dbSetThreadModel(threadId, modelId);
  });

  ipcMain.handle("chat:get-settings", async (): Promise<ChatSettingsDTO> => {
    const config = loadConfig();
    const defaultModel =
      config.llm_provider === "ollama"
        ? config.ollama.model
        : config.llm_provider === "openai"
          ? config.openai.model
          : config.claude.model;
    return {
      system_prompt: readChatSystemPrompt(),
      default_system_prompt: DEFAULT_CHAT_SYSTEM_PROMPT,
      default_model: defaultModel ?? null,
    };
  });

  ipcMain.handle("chat:save-system-prompt", async (_e, body: string) => {
    writeChatSystemPrompt(body);
  });

  ipcMain.handle("chat:reset-system-prompt", async () => {
    resetChatSystemPrompt();
  });

  ipcMain.handle("chat:backfill-start", async (): Promise<ChatBackfillProgressDTO> => {
    const bf = getOrCreateBackfill();
    // Kick off in the background — don't block the handler on the full run.
    bf.start().catch((err) => {
      appLogger.warn("backfill failed", {
        detail: err instanceof Error ? err.message : String(err),
      });
    });
    return bf.getProgress();
  });

  ipcMain.handle("chat:backfill-status", async (): Promise<ChatBackfillProgressDTO> => {
    if (backfillInstance) return backfillInstance.getProgress();
    return latestBackfillProgress;
  });

  ipcMain.handle("chat:backfill-count-pending", async (): Promise<number> => {
    const bf = getOrCreateBackfill();
    try {
      return bf.countPending();
    } catch {
      return 0;
    }
  });

  ipcMain.handle("chat:list-participants", async (): Promise<ParticipantDTO[]> => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT p.participant_id, p.first_name, p.last_name, p.email,
                COUNT(rp.run_id) AS run_count
         FROM participants p
         LEFT JOIN run_participants rp ON rp.participant_id = p.participant_id
         GROUP BY p.participant_id
         ORDER BY run_count DESC, p.first_name, p.last_name`
      )
      .all() as Array<{
      participant_id: number;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      run_count: number;
    }>;
    return rows.map((r) => ({
      participant_id: r.participant_id,
      first_name: r.first_name,
      last_name: r.last_name,
      email: r.email,
      label:
        [r.first_name, r.last_name].filter(Boolean).join(" ").trim() ||
        r.email ||
        "Unknown",
      run_count: r.run_count,
    }));
  });

  ipcMain.handle(
    "chat:embed-model-status",
    async (): Promise<{ model: string; installed: boolean }> => {
      const config = loadConfig();
      try {
        const models = await listOllamaModels(config.ollama.base_url);
        const installed = models.some(
          (m) =>
            m.name === DEFAULT_EMBEDDING_MODEL ||
            m.name.startsWith(`${DEFAULT_EMBEDDING_MODEL}:`)
        );
        return { model: DEFAULT_EMBEDDING_MODEL, installed };
      } catch {
        return { model: DEFAULT_EMBEDDING_MODEL, installed: false };
      }
    }
  );

  ipcMain.handle("chat:install-embed-model", async (): Promise<void> => {
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
      appLogger.warn("chat:install-embed-model failed", { detail: message });
      throw err;
    }
  });
}
