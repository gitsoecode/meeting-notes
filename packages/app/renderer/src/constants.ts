/**
 * Curated catalog of LLM models the dropdowns surface as first-class
 * options. The actual config fields are free-form strings, so a user can
 * still type any Claude model id or any Ollama tag via the "Custom…"
 * fallback — this list just gives them a sane default set.
 *
 * Local model picks (Ollama) are intentionally biased toward transcript
 * work: action-item extraction, structured outputs, agentic prompts.
 * Sizes are approximate — replace with values from `ollama show <tag>`
 * before shipping. The exact tags should be verified against
 * https://ollama.com/library before relying on them.
 */
export type LlmProviderKind = "claude" | "ollama";

export interface LlmModelEntry {
  id: string;
  label: string;
  provider: LlmProviderKind;
  /** Local-only: download size in GB. Used for the install hint UX. */
  sizeGb?: number;
  /** Local-only: minimum recommended system RAM in GB. Used to disable picks the user can't run. */
  minRamGb?: number;
  /** One-line description shown in the picker. */
  blurb?: string;
}

export const LLM_MODELS: LlmModelEntry[] = [
  // ---- Claude (cloud) ----
  {
    id: "claude-opus-4-6",
    label: "Opus 4.6 (smartest)",
    provider: "claude",
    blurb: "Anthropic's most capable model. Best for nuanced summaries.",
  },
  {
    id: "claude-sonnet-4-6",
    label: "Sonnet 4.6 (balanced)",
    provider: "claude",
    blurb: "Fast, capable, the default for most prompts.",
  },
  {
    id: "claude-haiku-4-5-20251001",
    label: "Haiku 4.5 (fastest)",
    provider: "claude",
    blurb: "Cheapest and quickest cloud option.",
  },
  // ---- Local (Ollama) ----
  // NOTE: tag strings below need to be verified against ollama.com/library
  // before merging — they are the best names I know of right now and may
  // need adjusting once published.
  {
    id: "qwen3.5:9b",
    label: "Qwen 3.5 9B (recommended)",
    provider: "ollama",
    sizeGb: 5.5,
    minRamGb: 16,
    blurb: "Best all-around local pick for transcript-style work.",
  },
  {
    id: "gemma4:e4b",
    label: "Gemma 4 E4B",
    provider: "ollama",
    sizeGb: 4.0,
    minRamGb: 16,
    blurb: "Lightweight Google model — quick to load, decent quality.",
  },
  {
    id: "qwen3:8b",
    label: "Qwen 3 8B (lighter, faster)",
    provider: "ollama",
    sizeGb: 5.0,
    minRamGb: 16,
    blurb: "Slightly smaller alternative with more RAM headroom.",
  },
  {
    id: "gemma3:12b",
    label: "Gemma 3 12B (slower, bigger)",
    provider: "ollama",
    sizeGb: 7.5,
    minRamGb: 24,
    blurb: "Higher quality, needs a bigger machine.",
  },
];

export function classifyModelClient(id: string): LlmProviderKind {
  return id.startsWith("claude-") ? "claude" : "ollama";
}

export function findModelEntry(id: string): LlmModelEntry | undefined {
  return LLM_MODELS.find((m) => m.id === id);
}

export function isKnownClaudeModel(id: string): boolean {
  return LLM_MODELS.some((m) => m.provider === "claude" && m.id === id);
}

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
