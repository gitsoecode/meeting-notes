import Anthropic from "@anthropic-ai/sdk";
import type { LlmProvider, LlmResponse, LlmCallOptions } from "./provider.js";
import { throwIfAborted } from "../../core/abort.js";

export class ClaudeProvider implements LlmProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model = "claude-sonnet-4-6") {
    this.client = new Anthropic({ apiKey });
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
    // When thinking is enabled, Claude requires temperature=1, so we only
    // apply a custom temperature when thinking is off.
    const useThinking = true;
    const createParams: Record<string, unknown> = {
      model,
      max_tokens: 16384,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    };
    if (useThinking) {
      createParams.thinking = { type: "enabled", budget_tokens: 10000 };
    } else if (options?.temperature != null) {
      createParams.temperature = options.temperature;
    }
    const response = await (this.client.messages.create as any)(
      createParams,
      options?.signal ? { signal: options.signal } : undefined
    );
    throwIfAborted(options?.signal);

    // Extract text content from response blocks
    const contentBlocks = response.content as Array<{ type: string; text?: string }>;
    const textBlocks = contentBlocks.filter(
      (block): block is { type: "text"; text: string } => block.type === "text" && typeof block.text === "string"
    );
    const content = textBlocks.map((block) => block.text).join("\n\n");

    return {
      content,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      model,
    };
  }
}
