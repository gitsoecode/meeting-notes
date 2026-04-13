/**
 * Sort value for interleaved meeting list ordering.
 * Priority: scheduled_time > updated_at > started > date.
 */
export function getRunSortValue(run: {
  scheduled_time?: string | null;
  updated_at?: string | null;
  started?: string;
  date?: string;
}): number {
  if (run.scheduled_time) {
    const st = Date.parse(run.scheduled_time);
    if (Number.isFinite(st)) return st;
  }
  if (run.updated_at) {
    const ua = Date.parse(run.updated_at);
    if (Number.isFinite(ua)) return ua;
  }
  const fallback = run.started || run.date || "";
  const fb = Date.parse(fallback);
  return Number.isFinite(fb) ? fb : 0;
}
