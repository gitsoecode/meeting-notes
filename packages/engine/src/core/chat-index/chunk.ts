import type { TranscriptSegment } from "../../adapters/asr/provider.js";
import type { ChunkInput } from "./types.js";

/**
 * Speaker-turn aware transcript chunker. Groups consecutive segments from the
 * same speaker, closing a chunk on speaker change or when total duration
 * exceeds ~120s. Carries forward a small tail of the prior chunk as context
 * prefix (kept out of start_ms math) so boundary-straddling ideas still match.
 */
export interface ChunkTranscriptOptions {
  maxDurationMs?: number;
  overlapCharsTail?: number;
  combinedAudioAvailable?: boolean;
}

const DEFAULT_MAX_DURATION_MS = 120_000;
const DEFAULT_OVERLAP_CHARS = 300;

export function chunkTranscript(
  segments: TranscriptSegment[],
  opts: ChunkTranscriptOptions = {}
): ChunkInput[] {
  const maxMs = opts.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const overlapChars = opts.overlapCharsTail ?? DEFAULT_OVERLAP_CHARS;
  const seekable = opts.combinedAudioAvailable !== false;

  if (segments.length === 0) return [];

  const chunks: ChunkInput[] = [];
  let current: {
    speaker: TranscriptSegment["speaker"];
    start_ms: number;
    end_ms: number;
    parts: string[];
  } | null = null;
  let lastTail = "";

  const emit = () => {
    if (!current) return;
    const coreText = current.parts.join(" ").replace(/\s+/g, " ").trim();
    if (!coreText) {
      current = null;
      return;
    }
    // Prepend tail from the prior chunk so semantic search can match
    // boundary-spanning ideas. The tail is plainly prefixed — the start_ms
    // still reflects the first real segment, so citations remain precise.
    const text = lastTail ? `${lastTail} | ${coreText}` : coreText;
    chunks.push({
      kind: "transcript",
      speaker: current.speaker ?? null,
      start_ms: current.start_ms,
      end_ms: current.end_ms,
      text,
      seekable,
    });
    lastTail = coreText.length > overlapChars
      ? "…" + coreText.slice(coreText.length - overlapChars)
      : coreText;
    current = null;
  };

  for (const seg of segments) {
    const segText = seg.text.trim();
    if (!segText) continue;

    if (!current) {
      current = {
        speaker: seg.speaker,
        start_ms: seg.start_ms,
        end_ms: seg.end_ms,
        parts: [segText],
      };
      continue;
    }

    const wouldOverflow = seg.end_ms - current.start_ms > maxMs;
    const speakerChanged = seg.speaker !== current.speaker;

    if (wouldOverflow || speakerChanged) {
      emit();
      current = {
        speaker: seg.speaker,
        start_ms: seg.start_ms,
        end_ms: seg.end_ms,
        parts: [segText],
      };
    } else {
      current.end_ms = seg.end_ms;
      current.parts.push(segText);
    }
  }
  emit();

  return chunks;
}

/**
 * Chunk plain markdown (summaries, prep, notes, imported text without
 * timestamps). Splits on heading boundaries first; long sections are
 * further split on paragraph boundaries at ~500-token targets. All produced
 * chunks are non-seekable (start_ms/end_ms null).
 */
export interface ChunkMarkdownOptions {
  kind: "summary" | "prep" | "notes";
  targetTokens?: number;
}

const DEFAULT_TARGET_TOKENS = 500;
const CHARS_PER_TOKEN_ESTIMATE = 3.5;

export function chunkMarkdown(
  markdown: string,
  opts: ChunkMarkdownOptions
): ChunkInput[] {
  const targetTokens = opts.targetTokens ?? DEFAULT_TARGET_TOKENS;
  const targetChars = Math.round(targetTokens * CHARS_PER_TOKEN_ESTIMATE);

  const sections = splitOnHeadings(markdown);
  const chunks: ChunkInput[] = [];

  for (const section of sections) {
    // Trim trailing whitespace per line (but preserve blank lines so
    // paragraph splitting still works).
    const cleaned = section
      .split("\n")
      .map((line) => line.replace(/\s+$/, ""))
      .join("\n")
      .trim();
    if (!cleaned) continue;

    if (cleaned.length <= targetChars) {
      chunks.push({
        kind: opts.kind,
        speaker: null,
        start_ms: null,
        end_ms: null,
        text: cleaned,
        seekable: false,
      });
      continue;
    }

    // Split long sections by paragraph (blank-line boundaries), packing
    // paragraphs into roughly targetChars-sized buckets.
    const paragraphs = cleaned.split(/\n\s*\n/);
    let buf: string[] = [];
    let bufLen = 0;
    for (const p of paragraphs) {
      const pLen = p.length + 2;
      if (buf.length > 0 && bufLen + pLen > targetChars) {
        chunks.push({
          kind: opts.kind,
          speaker: null,
          start_ms: null,
          end_ms: null,
          text: buf.join("\n\n").trim(),
          seekable: false,
        });
        buf = [];
        bufLen = 0;
      }
      buf.push(p);
      bufLen += pLen;
    }
    if (buf.length > 0) {
      chunks.push({
        kind: opts.kind,
        speaker: null,
        start_ms: null,
        end_ms: null,
        text: buf.join("\n\n").trim(),
        seekable: false,
      });
    }
  }

  return chunks;
}

function splitOnHeadings(md: string): string[] {
  const lines = md.split("\n");
  const sections: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line) && current.length > 0) {
      sections.push(current.join("\n"));
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) sections.push(current.join("\n"));
  return sections.length === 0 ? [md] : sections;
}
