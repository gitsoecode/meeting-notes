export interface LlmResponse {
  content: string;
  tokensUsed?: number;
  model?: string;
}

export interface LlmProvider {
  call(systemPrompt: string, userMessage: string): Promise<LlmResponse>;
}
