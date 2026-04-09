export interface InterruptedRunUpdate {
  ended: string;
  duration_minutes: number | null;
}

export function buildInterruptedRunUpdate(
  startedAt: string,
  endedAt: string
): InterruptedRunUpdate {
  const startMs = Date.parse(startedAt);
  const endMs = Date.parse(endedAt);
  return {
    ended: endedAt,
    duration_minutes:
      Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
        ? (endMs - startMs) / 60000
        : null,
  };
}
