import fs from "node:fs";
import OpenAI from "openai";
import type { AsrProvider, TranscriptResult, TranscriptSegment, AsrCallOptions } from "./provider.js";
import { throwIfAborted } from "../../core/abort.js";

export class OpenAIWhisperProvider implements AsrProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model = "whisper-1") {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async transcribe(
    audioPath: string,
    speaker: "me" | "others" | "unknown" = "unknown",
    options?: AsrCallOptions
  ): Promise<TranscriptResult> {
    throwIfAborted(options?.signal);
    const start = Date.now();
    const file = fs.createReadStream(audioPath);

    const response = await (this.client.audio.transcriptions.create as any)(
      {
        file,
        model: this.model,
        response_format: "verbose_json",
        timestamp_granularities: ["segment"],
      },
      options?.signal ? { signal: options.signal } : undefined
    );

    throwIfAborted(options?.signal);

    const durationMs = Date.now() - start;

    // Parse segments from verbose JSON response
    const rawSegments = (response.segments ?? []) as Array<{
      start?: number;
      end?: number;
      text: string;
    }>;
    const segments: TranscriptSegment[] = rawSegments.map((seg) => ({
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
