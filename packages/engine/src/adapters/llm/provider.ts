export interface LlmResponse {
  content: string;
  tokensUsed?: number;
  model?: string;
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
    modelOverride?: string
  ): Promise<LlmResponse>;
}
