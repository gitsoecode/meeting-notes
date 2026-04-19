import type { TranscriptSegment } from "../../adapters/asr/provider.js";

/**
 * Parse a `transcript.md` file written by `formatTranscriptMarkdown` back into
 * approximate segments. Only minute/second precision is available from the
 * rendered form — good enough for chunk boundaries and click-to-seek
 * citations (the combined.wav is already aligned at second granularity).
 *
 * Format it expects:
 *   ### Me
 *
 *   `01:23` Hello there
 *
 *   `01:25` more text
 *
 *   ### Others
 *
 *   `01:30` reply
 */
export function parseTranscriptMarkdown(md: string): TranscriptSegment[] {
  const lines = md.split("\n");
  const segments: TranscriptSegment[] = [];
  let currentSpeaker: "me" | "others" | "unknown" = "unknown";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headerMatch = /^###\s+(Me|Others|Unknown)\s*$/i.exec(line);
    if (headerMatch) {
      const label = headerMatch[1].toLowerCase();
      currentSpeaker = label === "me" ? "me" : label === "others" ? "others" : "unknown";
      continue;
    }

    // Match both MM:SS and HH:MM:SS prefixes.
    const tsMatch = /^`(\d+:\d+(?::\d+)?)`\s+(.*)$/.exec(line.trim());
    if (!tsMatch) continue;

    const startMs = timestampToMs(tsMatch[1]);
    const text = tsMatch[2].trim();
    if (!text) continue;

    segments.push({
      start_ms: startMs,
      end_ms: startMs, // end will be patched below using next segment's start
      text,
      speaker: currentSpeaker,
    });
  }

  // Patch end_ms using next start as an upper bound, clamped to a 60s cap to
  // avoid creating huge chunk windows when a long monologue has no follow-up.
  for (let i = 0; i < segments.length; i++) {
    const nextStart =
      i + 1 < segments.length ? segments[i + 1].start_ms : segments[i].start_ms + 15_000;
    const upper = Math.min(nextStart, segments[i].start_ms + 60_000);
    segments[i].end_ms = Math.max(segments[i].start_ms + 1_000, upper);
  }

  return segments;
}

function timestampToMs(ts: string): number {
  const parts = ts.split(":").map((s) => parseInt(s, 10));
  if (parts.some((p) => !Number.isFinite(p))) return 0;
  let totalSeconds = 0;
  if (parts.length === 3) {
    totalSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    totalSeconds = parts[0] * 60 + parts[1];
  } else {
    totalSeconds = parts[0];
  }
  return totalSeconds * 1000;
}
