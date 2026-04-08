import Anthropic from "@anthropic-ai/sdk";
import type { LlmProvider, LlmResponse } from "./provider.js";

export class ClaudeProvider implements LlmProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model = "claude-sonnet-4-6") {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async call(systemPrompt: string, userMessage: string): Promise<LlmResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 16384,
      thinking: {
        type: "enabled",
        budget_tokens: 10000,
      },
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    // Extract text content from response blocks
    const textBlocks = response.content.filter((block) => block.type === "text");
    const content = textBlocks.map((block) => block.text).join("\n\n");

    return {
      content,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
      model: this.model,
    };
  }
}
