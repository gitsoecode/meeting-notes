/**
 * Parse a `MM:SS` or `HH:MM:SS` transcript timestamp into seconds.
 * Returns NaN when the input is malformed so callers can short-circuit.
 */
export function parseTimestamp(value: string | null | undefined): number {
  if (!value) return NaN;
  const parts = value.trim().split(":");
  if (parts.length < 2 || parts.length > 3) return NaN;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return NaN;
  if (parts.length === 2) {
    const [m, s] = nums;
    return m * 60 + s;
  }
  const [h, m, s] = nums;
  return h * 3600 + m * 60 + s;
}

/**
 * Format a duration in seconds as `mm:ss` (or `h:mm:ss` when >= 1h).
 * Negative values clamp to zero; non-finite input yields "0:00".
 */
export function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${mm}:${ss}`;
  return `${m}:${ss}`;
}

/**
 * Given an ordered list of transcript entries (grouped by speaker) and the
 * player's current time, return the index of the latest entry whose
 * timestamp is <= currentTime. Used to drive the "currently playing" line
 * highlight. Returns null when nothing has played yet.
 *
 * `entries` is a flat list in transcript order. Each element's `timeSec` is
 * the result of `parseTimestamp` on its line; NaN entries are skipped so
 * timestamp-less lines never "win".
 */
export function findActiveEntryIndex(
  entries: ReadonlyArray<{ timeSec: number }>,
  currentTimeSec: number,
): number | null {
  if (!Number.isFinite(currentTimeSec) || currentTimeSec < 0) return null;
  let best: number | null = null;
  for (let i = 0; i < entries.length; i++) {
    const t = entries[i].timeSec;
    if (!Number.isFinite(t)) continue;
    if (t <= currentTimeSec) best = i;
    else break;
  }
  return best;
}
