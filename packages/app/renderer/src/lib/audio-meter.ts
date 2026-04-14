/**
 * Shared helpers for rendering audio-level meters in the renderer.
 *
 * The dB scale maps −60 dB (floor) → 0% fill and 0 dB (ceiling) → 100%.
 * These numbers match the scale used by the main-process `audio-monitor`
 * and the Settings → Audio and live-view meters.
 */

const DB_FLOOR = -60;
const DB_CEIL = 0;

/** Convert a dB value to a 0–100 percentage for bar fill width. */
export function dbToPct(db?: number): number {
  if (typeof db !== "number" || !Number.isFinite(db)) return 0;
  const clamped = Math.min(DB_CEIL, Math.max(DB_FLOOR, db));
  return Math.round(((clamped - DB_FLOOR) / (DB_CEIL - DB_FLOOR)) * 100);
}

/**
 * Threshold-based fill color (green / amber / red) as a hard alternative
 * to the `Meter` primitive's default gradient. Retained for callers that
 * need the classic three-step behaviour (e.g., probe indicators).
 */
export function levelColor(db?: number): string {
  if (typeof db !== "number") return "var(--border-subtle)";
  if (db > -6) return "var(--danger, #ef4444)";
  if (db > -18) return "var(--warning, #f59e0b)";
  return "var(--success, #10b981)";
}

/** A signal is considered "present" if peak exceeds the noise floor (~−55 dB). */
export function hasAudibleSignal(peakDb?: number): boolean {
  return typeof peakDb === "number" && peakDb > -55;
}
