import type { TranscriptResult, TranscriptSegment } from "../adapters/asr/provider.js";

/**
 * Drop `me` segments whose text near-matches a concurrent `others` segment.
 *
 * Rationale: the mic commonly re-captures system audio (speakers playing
 * remote participants' voices). Even after audio-level AEC, residual bleed
 * can produce ASR segments attributed to `me` that are actually quotes
 * from others. Because the same phrase tends to appear on both channels
 * at almost the same timestamp, a high text-similarity overlap is a
 * reliable signal of bleed.
 *
 * Short phrases like "yeah" or "okay" legitimately appear on both channels
 * when people say the same thing in quick succession, so we guard with a
 * minimum text length.
 */
export function dedupOverlappingSpeakers(
  result: TranscriptResult,
  opts?: {
    overlapToleranceMs?: number;
    similarityThreshold?: number;
    minTextLength?: number;
    /** Min normalized-length ratio to accept a substring/containment match. */
    containmentMinRatio?: number;
  }
): TranscriptResult {
  // Pipeline latency between avfoundation (mic) and AudioTee (system) plus
  // ASR segmentation differences can easily put "the same content" 3–5s
  // apart. Bias toward catching real bleed; the minTextLength + similarity
  // threshold still protect against false positives.
  const overlapToleranceMs = opts?.overlapToleranceMs ?? 5000;
  const similarityThreshold = opts?.similarityThreshold ?? 0.6;
  const minTextLength = opts?.minTextLength ?? 12;
  const containmentMinRatio = opts?.containmentMinRatio ?? 0.55;

  const othersSegments = result.segments.filter((s) => s.speaker === "others");
  if (othersSegments.length === 0) return result;

  // Precompute a normalized version of each others segment so we can also
  // check substring containment across the entire `others` transcript —
  // useful when ASR splits the same utterance differently on each channel.
  const normOthers = othersSegments.map((o) => ({ seg: o, norm: normalizeText(o.text) }));
  const allOthersText = normOthers.map((o) => o.norm).join(" ");

  const kept: TranscriptSegment[] = [];
  let dropped = 0;

  for (const seg of result.segments) {
    if (seg.speaker !== "me") {
      kept.push(seg);
      continue;
    }
    const normMe = normalizeText(seg.text);
    if (normMe.length < minTextLength) {
      kept.push(seg);
      continue;
    }

    // Full-similarity match against any overlapping `others` segment.
    const similarOverlap = normOthers.some(({ seg: other, norm }) => {
      if (!segmentsOverlap(seg, other, overlapToleranceMs)) return false;
      if (norm.length < minTextLength) return false;
      return textSimilarity(normMe, norm) >= similarityThreshold;
    });

    // Containment match: the me-text is a large-fraction substring of the
    // full others transcript. This catches cases where ASR splits the
    // bleed into smaller pieces than the clean system track, so per-segment
    // similarity undershoots but the content is unambiguously duplicated.
    const contained =
      !similarOverlap &&
      normMe.length >= minTextLength &&
      allOthersText.includes(normMe) &&
      normMe.length / Math.max(1, allOthersText.length) > 0 &&
      hasNearbyOthers(seg, othersSegments, overlapToleranceMs);

    // Partial-containment match: accept when a majority of normMe (>= ratio)
    // is a substring of some overlapping others segment. Handles
    // mic-splits-into-two-pieces-of-one-others-segment.
    const partialContained =
      !similarOverlap &&
      !contained &&
      normOthers.some(({ seg: other, norm }) => {
        if (!segmentsOverlap(seg, other, overlapToleranceMs)) return false;
        if (norm.length < minTextLength) return false;
        return norm.includes(normMe) && normMe.length / norm.length >= containmentMinRatio;
      });

    if (similarOverlap || contained || partialContained) {
      dropped += 1;
      continue;
    }
    kept.push(seg);
  }

  if (dropped === 0) return result;

  return {
    ...result,
    segments: kept,
    fullText: kept.map((s) => s.text).join(" "),
  };
}

function hasNearbyOthers(
  seg: TranscriptSegment,
  others: TranscriptSegment[],
  toleranceMs: number
): boolean {
  return others.some((o) => segmentsOverlap(seg, o, toleranceMs));
}

function segmentsOverlap(
  a: TranscriptSegment,
  b: TranscriptSegment,
  toleranceMs: number
): boolean {
  // Expand each segment by the tolerance on both sides, then check overlap.
  const aStart = a.start_ms - toleranceMs;
  const aEnd = a.end_ms + toleranceMs;
  return aEnd >= b.start_ms && aStart <= b.end_ms;
}

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Normalized similarity in [0, 1] based on Levenshtein edit distance.
 * 1.0 = identical; 0.0 = maximally different.
 */
function textSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const distance = levenshtein(a, b);
  return 1 - distance / maxLen;
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  // Two-row DP to keep memory O(min(|a|, |b|)).
  const short = a.length < b.length ? a : b;
  const long = a.length < b.length ? b : a;
  let prev = new Array<number>(short.length + 1);
  let curr = new Array<number>(short.length + 1);
  for (let i = 0; i <= short.length; i++) prev[i] = i;
  for (let j = 1; j <= long.length; j++) {
    curr[0] = j;
    for (let i = 1; i <= short.length; i++) {
      const cost = short[i - 1] === long[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        curr[i - 1] + 1,
        prev[i] + 1,
        prev[i - 1] + cost
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[short.length];
}

export function formatTranscriptMarkdown(result: TranscriptResult): string {
  if (result.segments.length === 0) {
    return result.fullText || "(empty transcript)";
  }

  const lines: string[] = [];
  let currentSpeaker: string | null = null;

  for (const seg of result.segments) {
    const timestamp = formatTimestamp(seg.start_ms);

    if (seg.speaker !== currentSpeaker && seg.speaker !== "unknown") {
      // Add speaker header when speaker changes
      if (lines.length > 0) lines.push("");
      lines.push(`### ${seg.speaker === "me" ? "Me" : "Others"}`);
      lines.push("");
      currentSpeaker = seg.speaker;
    }

    // Each segment is its own paragraph so the renderer breaks between
    // timecodes instead of collapsing them into a single soft-wrapped block.
    lines.push(`\`${timestamp}\` ${seg.text}`);
    lines.push("");
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
