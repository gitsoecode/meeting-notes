import Anthropic from "@anthropic-ai/sdk";
import type { LlmProvider, LlmResponse, LlmCallOptions } from "./provider.js";
import { throwIfAborted } from "../../core/abort.js";

/**
 * Minimal structural shape of the pieces of the Anthropic SDK we actually
 * call. Tests inject a fake that matches this shape without needing a
 * real API key.
 */
export interface ClaudeStreamLike {
  on(event: "text", cb: (text: string) => void): unknown;
  finalMessage(): Promise<{
    usage: { input_tokens: number; output_tokens: number };
  }>;
}

export interface ClaudeClientLike {
  messages: {
    stream(
      params: Record<string, unknown>,
      options?: { signal?: AbortSignal }
    ): ClaudeStreamLike;
  };
}

export class ClaudeProvider implements LlmProvider {
  private client: ClaudeClientLike;
  private model: string;

  constructor(apiKey: string, model = "claude-sonnet-4-6", client?: ClaudeClientLike) {
    this.client = client ?? (new Anthropic({ apiKey }) as unknown as ClaudeClientLike);
    this.model = model;
  }

  async call(
    systemPrompt: string,
    userMessage: string,
    modelOverride?: string,
    options?: LlmCallOptions
  ): Promise<LlmResponse> {
    const model = modelOverride && modelOverride.trim() ? modelOverride : this.model;
    throwIfAborted(options?.signal);

    // Thinking is intentionally NOT enabled. Adaptive thinking delays
    // time-to-first-text by 30–90+ seconds on long inputs (e.g. a 14k-
    // token transcript cleanup), which surfaced as a "0 output tokens"
    // hang in the UI — the streaming callbacks only fire on text_delta,
    // and nothing streams while the model is thinking. Meeting prompts
    // don't need extended reasoning; omitting `thinking` gets first
    // tokens within 1–2s and keeps the UI live.
    const params: Record<string, unknown> = {
      model,
      max_tokens: 50000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    };
    if (options?.temperature != null) {
      params.temperature = options.temperature;
    }

    let content = "";
    let chunkCount = 0;
    let lastProgressAt = 0;

    const stream = this.client.messages.stream(
      params,
      options?.signal ? { signal: options.signal } : undefined
    );

    stream.on("text", (text: string) => {
      content += text;
      chunkCount++;
      const now = Date.now();
      if (options?.onTokenProgress && now - lastProgressAt >= 500) {
        lastProgressAt = now;
        options.onTokenProgress(chunkCount, content.length);
      }
    });

    const final = await stream.finalMessage();
    throwIfAborted(options?.signal);

    const inputTokens = final.usage.input_tokens;
    const outputTokens = final.usage.output_tokens;

    // Snap to the real output-token count so the final UI reading matches
    // the "{N} output tokens" label exactly.
    options?.onTokenProgress?.(outputTokens, content.length);

    return {
      content,
      tokensUsed: inputTokens + outputTokens,
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      model,
    };
  }
}
