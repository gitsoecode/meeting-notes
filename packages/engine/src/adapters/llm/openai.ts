import OpenAI from "openai";
import type { LlmProvider, LlmResponse, LlmCallOptions } from "./provider.js";
import { throwIfAborted } from "../../core/abort.js";

export class OpenAIProvider implements LlmProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model = "gpt-4o") {
    this.client = new OpenAI({ apiKey });
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

    const response = await this.client.chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      },
      options?.signal ? { signal: options.signal } : undefined
    );

    throwIfAborted(options?.signal);

    const content = response.choices[0]?.message?.content ?? "";
    const tokensUsed = response.usage
      ? response.usage.prompt_tokens + response.usage.completion_tokens
      : undefined;

    return {
      content,
      tokensUsed,
      model,
    };
  }
}
