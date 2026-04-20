import { EventEmitter } from "node:events";
import {
  ClaudeProvider,
  OpenAIProvider,
  OllamaProvider,
  classifyModel,
  createOllamaEmbedder,
  DEFAULT_EMBEDDING_MODEL,
  embedViaOllama,
  getSecret,
  loadConfig,
  createAppLogger,
  type LlmProvider,
  type SearchResult,
  type StoredCitation,
} from "@gistlist/engine";
import { searchMeetings } from "../chat-index/retrieve.js";
import { addMessage, createThread, listMessages, getThread, renameThread } from "./threads.js";
import { readChatSystemPrompt } from "./prompt.js";
import {
  EMPTY_RESULT_MESSAGE,
  FAIL_CLOSED_MESSAGE,
  META_CANNED_RESPONSE,
  hasCitations,
  isMetaQuery,
  requiresCitation,
} from "./guardrails.js";
import { buildStoredCitations, stripInvalidCitations } from "./citation-parser.js";

const appLogger = createAppLogger(false);

export type ChatStreamEvent =
  | { type: "messageStart"; message_id: string; thread_id: string }
  | { type: "status"; label: string }
  | { type: "token"; chunk: string }
  | {
      type: "messageComplete";
      message_id: string;
      thread_id: string;
      content: string;
      citations: StoredCitation[];
    }
  | { type: "error"; error: string }
  | { type: "threadTitle"; thread_id: string; title: string };

export interface SendMessageRequest {
  threadId?: string; // if absent, a new thread is created
  userMessage: string;
  modelOverride?: string;
  filters?: {
    participant?: string;
    date_range?: { from: string; to: string };
    status?: "past" | "upcoming" | "any";
  };
}

export interface SendMessageResult {
  thread_id: string;
  user_message_id: string;
  assistant_message_id: string;
  content: string;
  citations: StoredCitation[];
}

/**
 * The "retrieval assistant" loop — not an agent. For each user turn:
 *   1. Detect meta queries → canned reply, no model call.
 *   2. Retrieve top-K chunks via hybrid FTS+vec.
 *   3. Single synthesis call to the LLM with the chunks as context.
 *   4. Strip out-of-scope citations; fail-closed if no citations on a
 *      multi-sentence factual response.
 *   5. Persist + emit.
 */
export async function sendMessage(
  req: SendMessageRequest,
  events: EventEmitter
): Promise<SendMessageResult> {
  const config = loadConfig();

  // 1. Ensure / create thread.
  let thread = req.threadId ? getThread(req.threadId) : null;
  if (!thread) {
    thread = createThread({ title: truncateTitle(req.userMessage) });
    events.emit("chat-event", { type: "threadTitle", thread_id: thread.thread_id, title: thread.title });
  }

  const userMsg = addMessage(thread.thread_id, "user", req.userMessage);
  const assistantMessageStub = { message_id: "", thread_id: thread.thread_id };

  // 2. Meta short-circuit.
  if (isMetaQuery(req.userMessage)) {
    const saved = addMessage(thread.thread_id, "assistant", META_CANNED_RESPONSE, []);
    events.emit("chat-event", {
      type: "messageComplete",
      message_id: saved.message_id,
      thread_id: thread.thread_id,
      content: META_CANNED_RESPONSE,
      citations: [],
    } satisfies ChatStreamEvent);
    return {
      thread_id: thread.thread_id,
      user_message_id: userMsg.message_id,
      assistant_message_id: saved.message_id,
      content: META_CANNED_RESPONSE,
      citations: [],
    };
  }

  events.emit("chat-event", {
    type: "messageStart",
    message_id: "",
    thread_id: thread.thread_id,
  } satisfies ChatStreamEvent);
  events.emit("chat-event", {
    type: "status",
    label: "Searching meetings…",
  } satisfies ChatStreamEvent);

  // 3. Retrieval.
  const embedder = createOllamaEmbedder({
    baseUrl: config.ollama.base_url,
    model: DEFAULT_EMBEDDING_MODEL,
  });
  const queryEmbedder = async (q: string): Promise<number[] | null> => {
    try {
      const vecs = await embedder([q]);
      return vecs[0] ?? null;
    } catch (err) {
      appLogger.warn("chat query embed failed", {
        detail: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  };

  let searchResults: SearchResult[] = [];
  try {
    searchResults = await searchMeetings(req.userMessage, {
      limit: 8,
      queryEmbedder,
      participant: req.filters?.participant,
      date_range: req.filters?.date_range,
      status: req.filters?.status,
    });
  } catch (err) {
    appLogger.warn("chat searchMeetings failed", {
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  if (searchResults.length === 0) {
    const saved = addMessage(thread.thread_id, "assistant", EMPTY_RESULT_MESSAGE, []);
    events.emit("chat-event", {
      type: "messageComplete",
      message_id: saved.message_id,
      thread_id: thread.thread_id,
      content: EMPTY_RESULT_MESSAGE,
      citations: [],
    } satisfies ChatStreamEvent);
    return {
      thread_id: thread.thread_id,
      user_message_id: userMsg.message_id,
      assistant_message_id: saved.message_id,
      content: EMPTY_RESULT_MESSAGE,
      citations: [],
    };
  }

  events.emit("chat-event", {
    type: "status",
    label: `Reading ${dedupTitles(searchResults).slice(0, 2).join(", ")}…`,
  } satisfies ChatStreamEvent);

  // 4. Synthesis.
  const modelId = req.modelOverride ?? thread.model_id ?? defaultChatModel(config);
  const provider = await buildProvider(modelId, config);
  const systemPrompt = readChatSystemPrompt();
  const userContent = buildSynthesisUserMessage(req.userMessage, searchResults);

  const history = listMessages(thread.thread_id);
  const historyBlock = formatHistoryContext(history, userMsg.message_id);

  const fullUser = historyBlock
    ? `${historyBlock}\n\n${userContent}`
    : userContent;

  let raw = "";
  try {
    const resp = await provider.call(systemPrompt, fullUser, modelId, {
      temperature: 0.2,
      onText: (delta, _accumulated) => {
        // Forward each chunk to the renderer so the UI can stream the
        // answer token-by-token.
        events.emit("chat-event", {
          type: "token",
          chunk: delta,
        } satisfies ChatStreamEvent);
      },
    });
    raw = resp.content;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    appLogger.warn("chat synthesis failed", { detail: message });
    const fallback = `I couldn't complete that request — ${message}`;
    const saved = addMessage(thread.thread_id, "assistant", fallback, []);
    events.emit("chat-event", {
      type: "error",
      error: message,
    } satisfies ChatStreamEvent);
    events.emit("chat-event", {
      type: "messageComplete",
      message_id: saved.message_id,
      thread_id: thread.thread_id,
      content: fallback,
      citations: [],
    } satisfies ChatStreamEvent);
    return {
      thread_id: thread.thread_id,
      user_message_id: userMsg.message_id,
      assistant_message_id: saved.message_id,
      content: fallback,
      citations: [],
    };
  }

  // 5. Guardrails.
  let cleaned = stripInvalidCitations(raw, searchResults);
  const { citations } = buildStoredCitations(cleaned, searchResults);

  if (requiresCitation(cleaned) && !hasCitations(cleaned)) {
    cleaned = FAIL_CLOSED_MESSAGE;
  }

  const saved = addMessage(thread.thread_id, "assistant", cleaned, citations);

  // If this was the first turn and the thread is still titled "New thread",
  // upgrade the title from the user message prefix.
  if (thread.title === "New thread" || thread.title.startsWith("Meeting -")) {
    const newTitle = truncateTitle(req.userMessage);
    renameThread(thread.thread_id, newTitle);
    events.emit("chat-event", {
      type: "threadTitle",
      thread_id: thread.thread_id,
      title: newTitle,
    } satisfies ChatStreamEvent);
  }

  events.emit("chat-event", {
    type: "messageComplete",
    message_id: saved.message_id,
    thread_id: thread.thread_id,
    content: cleaned,
    citations,
  } satisfies ChatStreamEvent);

  return {
    thread_id: thread.thread_id,
    user_message_id: userMsg.message_id,
    assistant_message_id: saved.message_id,
    content: cleaned,
    citations,
  };
}

function truncateTitle(message: string): string {
  const cleaned = message.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 60) return cleaned || "New thread";
  return cleaned.slice(0, 60).trim() + "…";
}

function dedupTitles(results: SearchResult[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of results) {
    if (seen.has(r.run_title)) continue;
    seen.add(r.run_title);
    out.push(r.run_title);
  }
  return out;
}

function formatHistoryContext(
  messages: { role: "user" | "assistant"; content: string }[],
  excludeUserMessageId: string
): string {
  // Drop the current user message (already in the synthesis block). Truncate
  // to last 6 turns to keep local-model contexts manageable.
  const tail = messages
    .filter((_m, idx) => idx < messages.length - 1) // exclude the last (current) user msg
    .slice(-6);
  if (tail.length === 0) return "";
  const rendered = tail
    .map((m) => `${m.role === "user" ? "Previous user message" : "Previous assistant answer"}: ${truncate(m.content, 600)}`)
    .join("\n\n");
  return `Conversation so far:\n\n${rendered}`;
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : t.slice(0, max) + "…";
}

function buildSynthesisUserMessage(
  userQuery: string,
  results: SearchResult[]
): string {
  const blocks: string[] = [];
  blocks.push(`User question: ${userQuery}`);
  blocks.push("");
  blocks.push("Relevant excerpts from the user's meetings. Each excerpt is labeled with its run_id, meeting title, date, status (past/upcoming), kind (transcript/summary/prep/notes), and — when available — a timestamp in milliseconds. Cite the EXACT run_id and timestamp shown.");
  blocks.push("");
  for (const r of results) {
    const tsLabel = r.start_ms != null ? ` t=${r.start_ms}ms` : "";
    const citeForm =
      r.start_ms != null
        ? `[[cite:${r.run_id}:${r.start_ms}]]`
        : `[[cite:${r.run_id}:${r.kind}]]`;
    blocks.push(
      `--- run_id=${r.run_id} title="${r.run_title}" date=${r.run_date} status=${r.run_status} kind=${r.kind}${tsLabel} participants=[${r.participants.join("; ") || "unknown"}] cite=${citeForm} ---`
    );
    blocks.push(r.text);
    blocks.push("");
  }
  blocks.push("Instructions: answer the user's question using only the excerpts above. Cite every factual claim with the `cite=` token shown next to the excerpt you used. If the excerpts don't answer the question, say so and suggest rephrasing.");
  return blocks.join("\n");
}

function defaultChatModel(config: ReturnType<typeof loadConfig>): string {
  // Prefer Ollama when configured; otherwise fall back to the provider's
  // default model. The renderer may also pass an explicit override.
  if (config.llm_provider === "ollama") return config.ollama.model;
  if (config.llm_provider === "openai") return config.openai.model;
  return config.claude.model;
}

async function buildProvider(
  modelId: string,
  config: ReturnType<typeof loadConfig>
): Promise<LlmProvider> {
  const kind = classifyModel(modelId);
  if (kind === "claude") {
    const key = await getSecret("claude");
    if (!key) throw new Error("Claude API key is not set. Add one in Settings → LLM.");
    return new ClaudeProvider(key, modelId);
  }
  if (kind === "openai") {
    const key = await getSecret("openai");
    if (!key) throw new Error("OpenAI API key is not set. Add one in Settings → LLM.");
    return new OpenAIProvider(key, modelId);
  }
  return new OllamaProvider(config.ollama.base_url, modelId, config.ollama.num_ctx);
}

// Exported helper for tests — not used by production code path.
export { embedViaOllama };
