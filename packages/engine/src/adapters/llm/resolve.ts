/**
 * Maps a model id to its provider kind. Used by the call-site factories
 * in process-run.ts and main/ipc.ts to dispatch each LLM call to the
 * right provider without the pipeline ever needing to know about
 * providers.
 *
 * Heuristic: anything starting with "claude-" is Anthropic; everything
 * else is treated as an Ollama tag (Ollama tags look like "qwen2.5:7b",
 * "llama3.1:8b", etc.). The "Custom…" inputs in the renderer let users
 * type any string, so we keep this dumb on purpose — if you pick the
 * wrong dropdown, the API call will fail with a clear error rather
 * than silently routing to the wrong place.
 */
export type LlmKind = "claude" | "ollama";

export function classifyModel(id: string): LlmKind {
  return id.startsWith("claude-") ? "claude" : "ollama";
}
