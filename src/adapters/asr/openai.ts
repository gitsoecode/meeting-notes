import fs from "node:fs";
import OpenAI from "openai";
import type { AsrProvider, TranscriptResult, TranscriptSegment } from "./provider.js";

export class OpenAIWhisperProvider implements AsrProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model = "whisper-1") {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async transcribe(
    audioPath: string,
    speaker: "me" | "others" | "unknown" = "unknown"
  ): Promise<TranscriptResult> {
    const start = Date.now();
    const file = fs.createReadStream(audioPath);

    const response = await this.client.audio.transcriptions.create({
      file,
      model: this.model,
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
    });

    const durationMs = Date.now() - start;

    // Parse segments from verbose JSON response
    const segments: TranscriptSegment[] = (response.segments ?? []).map((seg) => ({
      start_ms: Math.round((seg.start ?? 0) * 1000),
      end_ms: Math.round((seg.end ?? 0) * 1000),
      text: seg.text.trim(),
      speaker,
    }));

    const fullText = segments.map((s) => s.text).join(" ");

    return {
      segments,
      fullText,
      provider: `openai/${this.model}`,
      durationMs,
    };
  }
}
