import OpenAI from "openai";
import type { LlmProvider, LlmResponse, LlmCallOptions } from "./provider.js";
import { throwIfAborted } from "../../core/abort.js";

/**
 * Minimal structural shape of the OpenAI SDK pieces we actually call. Tests
 * inject a fake that matches this shape without needing a real API key.
 */
interface OpenAIChunkLike {
  choices: Array<{ delta?: { content?: string | null } }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export interface OpenAIClientLike {
  chat: {
    completions: {
      create(
        params: Record<string, unknown>,
        options?: { signal?: AbortSignal }
      ): Promise<AsyncIterable<OpenAIChunkLike>>;
    };
  };
}

export class OpenAIProvider implements LlmProvider {
  private client: OpenAIClientLike;
  private model: string;

  constructor(apiKey: string, model = "gpt-4o", client?: OpenAIClientLike) {
    this.client = client ?? (new OpenAI({ apiKey }) as unknown as OpenAIClientLike);
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

    const stream = await this.client.chat.completions.create(
      {
        model,
        temperature: options?.temperature ?? undefined,
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      },
      options?.signal ? { signal: options.signal } : undefined
    );

    let content = "";
    let chunkCount = 0;
    let lastProgressAt = 0;
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        content += delta;
        chunkCount++;
        options?.onText?.(delta, content);
        const now = Date.now();
        if (options?.onTokenProgress && now - lastProgressAt >= 500) {
          lastProgressAt = now;
          options.onTokenProgress(chunkCount, content.length);
        }
      }
      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens;
        completionTokens = chunk.usage.completion_tokens;
      }
    }
    throwIfAborted(options?.signal);

    // Snap to the real output-token count so the final UI reading matches
    // the "{N} output tokens" label exactly.
    options?.onTokenProgress?.(completionTokens ?? chunkCount, content.length);

    const tokensUsed =
      promptTokens != null && completionTokens != null
        ? promptTokens + completionTokens
        : undefined;

    return {
      content,
      tokensUsed,
      promptTokens,
      completionTokens,
      model,
    };
  }
}
