export {
  LLM_MODELS,
  classifyAppModel as classifyModelClient,
  findModelEntry,
  isKnownClaudeModel,
  localModelIdsMatch,
  normalizeModelId,
  type LlmModelEntry,
  type LlmProviderKind,
} from "../../shared/llm-catalog";

/**
 * Pick a sensible default local model for a machine with `ramGb` of RAM.
 * Pure function — kept testable and out of the React tree.
 */
export function recommendLocalModel(ramGb: number | undefined): string {
  if (!ramGb || ramGb < 16) return "qwen3:8b";
  if (ramGb >= 24) return "qwen3.5:9b";
  return "qwen3.5:9b";
}

/** Format an ISO date as a relative label like "Today" / "Yesterday" / "3d ago". */
export function relativeDateLabel(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const now = Date.now();
  const diffMs = now - t;
  const day = 24 * 60 * 60 * 1000;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfThat = new Date(t);
  startOfThat.setHours(0, 0, 0, 0);
  const dayDiff = Math.round(
    (startOfToday.getTime() - startOfThat.getTime()) / day
  );
  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff > 1 && dayDiff < 7) return `${dayDiff}d ago`;
  if (dayDiff >= 7 && dayDiff < 30) return `${Math.floor(dayDiff / 7)}w ago`;
  if (diffMs < 0) return new Date(t).toLocaleDateString();
  return new Date(t).toLocaleDateString();
}

/** Format an ISO date as a granular relative label like "3h ago" / "Yesterday" / "3d ago". */
export function relativeTimeLabel(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const now = Date.now();
  const diffMs = now - t;
  if (diffMs < 0) return new Date(t).toLocaleDateString();

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const day = 24 * 60 * 60 * 1000;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfThat = new Date(t);
  startOfThat.setHours(0, 0, 0, 0);
  const dayDiff = Math.round(
    (startOfToday.getTime() - startOfThat.getTime()) / day
  );
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff > 1 && dayDiff < 7) return `${dayDiff}d ago`;
  if (dayDiff >= 7 && dayDiff < 30) return `${Math.floor(dayDiff / 7)}w ago`;
  return new Date(t).toLocaleDateString();
}

/** Format an ISO scheduled time as a compact label like "Apr 15, 2:00 PM". */
export function formatScheduledTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
