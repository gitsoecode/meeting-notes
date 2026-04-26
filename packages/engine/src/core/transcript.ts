import type { TranscriptResult, TranscriptSegment } from "../adapters/asr/provider.js";

export interface DuplicateSpeakerCandidate {
  me: TranscriptSegment;
  others: TranscriptSegment[];
  reason: "similarity" | "containment" | "token-overlap";
  score: number;
}

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
    tokenOverlapThreshold?: number;
  }
): TranscriptResult {
  const candidates = findDuplicateSpeakerSegments(result, opts);
  if (candidates.length === 0) return result;
  const drop = new Set(candidates.map((c) => c.me));
  const kept = result.segments.filter((seg) => !drop.has(seg));
  return {
    ...result,
    segments: kept,
    fullText: kept.map((s) => s.text).join(" "),
  };
}

export function findDuplicateSpeakerSegments(
  result: TranscriptResult,
  opts?: {
    overlapToleranceMs?: number;
    similarityThreshold?: number;
    minTextLength?: number;
    containmentMinRatio?: number;
    tokenOverlapThreshold?: number;
  }
): DuplicateSpeakerCandidate[] {
  // Pipeline latency between avfoundation (mic) and AudioTee (system) plus
  // ASR segmentation differences can easily put "the same content" 3–5s
  // apart. Bias toward catching real bleed; the minTextLength + similarity
  // threshold still protect against false positives.
  const overlapToleranceMs = opts?.overlapToleranceMs ?? 5000;
  const similarityThreshold = opts?.similarityThreshold ?? 0.6;
  const minTextLength = opts?.minTextLength ?? 12;
  const containmentMinRatio = opts?.containmentMinRatio ?? 0.55;
  const tokenOverlapThreshold = opts?.tokenOverlapThreshold ?? 0.74;

  const othersSegments = result.segments.filter((s) => s.speaker === "others");
  if (othersSegments.length === 0) return [];

  // Precompute a normalized version of each others segment so we can also
  // check substring containment across the entire `others` transcript —
  // useful when ASR splits the same utterance differently on each channel.
  const normOthers = othersSegments.map((o) => ({ seg: o, norm: normalizeText(o.text) }));
  const candidates: DuplicateSpeakerCandidate[] = [];

  for (const seg of result.segments) {
    if (seg.speaker !== "me") {
      continue;
    }
    const normMe = normalizeText(seg.text);
    if (normMe.length < minTextLength) {
      continue;
    }

    const nearby = normOthers.filter(({ seg: other, norm }) =>
      norm.length >= minTextLength && segmentsOverlap(seg, other, overlapToleranceMs)
    );
    if (nearby.length === 0) continue;

    const nearbyText = nearby.map(({ norm }) => norm).join(" ");
    let best: DuplicateSpeakerCandidate | null = null;

    for (const other of nearby) {
      const score = textSimilarity(normMe, other.norm);
      if (score >= similarityThreshold) {
        best = chooseBetterCandidate(best, {
          me: seg,
          others: [other.seg],
          reason: "similarity",
          score,
        });
      }
    }

    const containmentScore = containmentRatio(normMe, nearbyText);
    if (containmentScore >= containmentMinRatio) {
      best = chooseBetterCandidate(best, {
        me: seg,
        others: nearby.map((o) => o.seg),
        reason: "containment",
        score: containmentScore,
      });
    }

    const tokenScore = tokenOverlap(normMe, nearbyText);
    if (tokenScore >= tokenOverlapThreshold) {
      best = chooseBetterCandidate(best, {
        me: seg,
        others: nearby.map((o) => o.seg),
        reason: "token-overlap",
        score: tokenScore,
      });
    }

    if (best) candidates.push(best);
  }

  return candidates;
}

function chooseBetterCandidate(
  current: DuplicateSpeakerCandidate | null,
  next: DuplicateSpeakerCandidate
): DuplicateSpeakerCandidate {
  if (!current || next.score > current.score) return next;
  return current;
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

function containmentRatio(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a.includes(b)) return b.length / a.length;
  if (b.includes(a)) return a.length / b.length;
  return 0;
}

function tokenOverlap(a: string, b: string): number {
  const aTokens = new Set(a.split(" ").filter((t) => t.length > 2));
  const bTokens = new Set(b.split(" ").filter((t) => t.length > 2));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let shared = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) shared += 1;
  }
  return shared / Math.min(aTokens.size, bTokens.size);
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

/**
 * Shift "others" ASR segment times onto the combined-playback timeline.
 *
 * The combined.wav mix advances the system track by `-offsetMs` (see
 * `mergeTimedAudioFiles` in audio.ts) so mic is the time reference.
 * ASR sees the raw system file, so its segment times are ahead of the
 * combined timeline by `offsetMs`. Subtract it to align.
 *
 * Segments are clamped so start/end never go negative. Segments whose
 * entire span predates the combined-file start (end_ms < 0 after the
 * shift) are dropped — they are inaudible in combined.wav and would
 * otherwise produce broken click-to-seek targets.
 */
export function applyOthersOffset(
  segments: TranscriptSegment[],
  offsetMs: number
): TranscriptSegment[] {
  if (offsetMs === 0) return segments;
  const out: TranscriptSegment[] = [];
  for (const seg of segments) {
    const end = seg.end_ms - offsetMs;
    if (end < 0) continue;
    const start = Math.max(0, seg.start_ms - offsetMs);
    out.push({ ...seg, start_ms: start, end_ms: end });
  }
  return out;
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
