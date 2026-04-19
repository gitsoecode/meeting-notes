export interface LlmResponse {
  content: string;
  tokensUsed?: number;
  /** Input/prompt tokens processed. */
  promptTokens?: number;
  /** Output/completion tokens generated. */
  completionTokens?: number;
  model?: string;
  /** Ollama: time to load the model into VRAM (ms). >0 means cold start. */
  loadDurationMs?: number;
  /** Ollama: prompt processing speed (tokens/sec). */
  promptEvalTokensPerSec?: number;
  /** Ollama: generation speed (tokens/sec). */
  evalTokensPerSec?: number;
}

export interface LlmCallOptions {
  signal?: AbortSignal;
  temperature?: number;
  onTokenProgress?: (tokensGenerated: number, charsGenerated: number) => void;
  /**
   * Live text chunks from the provider as they're received. Useful for
   * token-by-token UI streaming (chat assistant). Not all providers emit
   * this — pipeline callers generally ignore it.
   */
  onText?: (delta: string, accumulated: string) => void;
}

export interface LlmProvider {
  /**
   * `modelOverride` lets the pipeline ask a single provider instance to
   * fulfill a call against a different model than its default — used by
   * the per-prompt-model override path. Implementations should fall back
   * to their constructor-time default when undefined or empty.
   */
  call(
    systemPrompt: string,
    userMessage: string,
    modelOverride?: string,
    options?: LlmCallOptions
  ): Promise<LlmResponse>;
}
