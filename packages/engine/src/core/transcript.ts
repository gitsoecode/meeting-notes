import type { TranscriptResult, TranscriptSegment } from "../adapters/asr/provider.js";

export function formatTranscriptMarkdown(result: TranscriptResult): string {
  if (result.segments.length === 0) {
    return result.fullText || "(empty transcript)";
  }

  const lines: string[] = [];
  let currentSpeaker: string | null = null;

  for (const seg of result.segments) {
    const timestamp = formatTimestamp(seg.start_ms);
    const speakerLabel = seg.speaker !== "unknown" ? `**${seg.speaker}**` : "";

    if (seg.speaker !== currentSpeaker && seg.speaker !== "unknown") {
      // Add speaker header when speaker changes
      lines.push("");
      lines.push(`### ${seg.speaker === "me" ? "Me" : "Others"}`);
      currentSpeaker = seg.speaker;
    }

    if (speakerLabel) {
      lines.push(`\`${timestamp}\` ${seg.text}`);
    } else {
      lines.push(`\`${timestamp}\` ${seg.text}`);
    }
  }

  return lines.join("\n").trim();
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function buildSpeakerExcerpts(result: TranscriptResult, speaker: "me" | "others"): string {
  return result.segments
    .filter((seg) => seg.speaker === speaker)
    .map((seg) => seg.text)
    .join("\n");
}

export function buildTranscriptForLlm(result: TranscriptResult): string {
  if (result.segments.length === 0) {
    return result.fullText || "(empty transcript)";
  }

  // For LLM consumption, include speaker labels inline
  return result.segments
    .map((seg) => {
      const label = seg.speaker !== "unknown" ? `[${seg.speaker}] ` : "";
      return `${label}${seg.text}`;
    })
    .join("\n");
}
