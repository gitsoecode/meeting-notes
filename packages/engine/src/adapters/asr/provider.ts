export interface TranscriptSegment {
  start_ms: number;
  end_ms: number;
  text: string;
  speaker: "me" | "others" | "unknown";
}

export interface TranscriptResult {
  segments: TranscriptSegment[];
  fullText: string;
  provider: string;
  durationMs: number;
}

export interface AsrCallOptions {
  signal?: AbortSignal;
}

export interface AsrProvider {
  transcribe(
    audioPath: string,
    speaker?: "me" | "others" | "unknown",
    options?: AsrCallOptions
  ): Promise<TranscriptResult>;
}
