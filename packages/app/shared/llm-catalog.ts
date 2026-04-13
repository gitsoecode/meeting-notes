export type LlmProviderKind = "claude" | "openai" | "ollama";

export interface LlmModelEntry {
  id: string;
  label: string;
  provider: LlmProviderKind;
  sizeGb?: number;
  minRamGb?: number;
  blurb?: string;
}

export const LLM_MODELS: LlmModelEntry[] = [
  {
    id: "claude-opus-4-6",
    label: "Opus 4.6",
    provider: "claude",
    blurb: "Anthropic's most capable model. Best for nuanced summaries.",
  },
  {
    id: "claude-sonnet-4-6",
    label: "Sonnet 4.6",
    provider: "claude",
    blurb: "Fast, capable, the default for most prompts.",
  },
  {
    id: "claude-haiku-4-5-20251001",
    label: "Haiku 4.5",
    provider: "claude",
    blurb: "Cheapest and quickest cloud option.",
  },
  {
    id: "gpt-4o",
    label: "GPT-4o",
    provider: "openai",
    blurb: "OpenAI's high-intelligence flagship model.",
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    provider: "openai",
    blurb: "Affordable and intelligent small model for fast summaries.",
  },
  {
    id: "o1-preview",
    label: "o1-preview",
    provider: "openai",
    blurb: "OpenAI's reasoning model for complex tasks.",
  },
  {
    id: "qwen3.5:0.8b",
    label: "qwen3.5:0.8b",
    provider: "ollama",
    sizeGb: 1.0,
    minRamGb: 4,
    blurb: "Ultra-tiny Qwen — runs on nearly anything, good for quick tests.",
  },
  {
    id: "qwen3.5:2b",
    label: "qwen3.5:2b",
    provider: "ollama",
    sizeGb: 2.7,
    minRamGb: 4,
    blurb: "Tiny Qwen variant — fastest local option for low-resource machines.",
  },
  {
    id: "qwen3.5:4b",
    label: "qwen3.5:4b",
    provider: "ollama",
    sizeGb: 2.6,
    minRamGb: 8,
    blurb: "Compact and fast — great for lower-RAM machines.",
  },
  {
    id: "qwen3.5:9b",
    label: "qwen3.5:9b",
    provider: "ollama",
    sizeGb: 5.5,
    minRamGb: 16,
    blurb: "Best all-around local pick for transcript-style work.",
  },
  {
    id: "llama3.1:8b",
    label: "llama3.1:8b",
    provider: "ollama",
    sizeGb: 4.7,
    minRamGb: 8,
    blurb: "Meta's open-weights flagship. Great performance/size ratio.",
  },
  {
    id: "mistral:latest",
    label: "mistral:latest",
    provider: "ollama",
    sizeGb: 4.1,
    minRamGb: 8,
    blurb: "Efficient and reliable local model.",
  },
  {
    id: "phi3:latest",
    label: "phi3:latest",
    provider: "ollama",
    sizeGb: 2.3,
    minRamGb: 4,
    blurb: "Microsoft's capable tiny model. Runs on almost anything.",
  },
  {
    id: "gemma4:e2b",
    label: "gemma4:e2b",
    provider: "ollama",
    sizeGb: 7.2,
    minRamGb: 16,
    blurb: "Google's smallest Gemma 4 — quick inference, modest quality.",
  },
  {
    id: "gemma4:e4b",
    label: "gemma4:e4b",
    provider: "ollama",
    sizeGb: 4.0,
    minRamGb: 16,
    blurb: "Lightweight Google model — quick to load, decent quality.",
  },
];

const LOCAL_MODEL_ALIASES: Record<string, string> = {
  "qwen3.5": "qwen3.5:9b",
  "qwen3.5:latest": "qwen3.5:9b",
  "llama3.1:latest": "llama3.1:8b",
};

export function classifyAppModel(id: string): LlmProviderKind {
  if (id.startsWith("claude-")) return "claude";
  if (id.startsWith("gpt-") || id.startsWith("o1-")) return "openai";
  return "ollama";
}

export function normalizeModelId(id: string | null | undefined): string | null {
  if (!id) return null;
  const trimmed = id.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("claude-")) return trimmed;
  const withoutLatest = trimmed.replace(/:latest$/, "");
  return LOCAL_MODEL_ALIASES[withoutLatest] ?? withoutLatest;
}

export function localModelIdsMatch(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  const normalizedLeft = normalizeModelId(left);
  const normalizedRight = normalizeModelId(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft === normalizedRight;
}

export function findModelEntry(id: string): LlmModelEntry | undefined {
  return LLM_MODELS.find((model) =>
    model.provider === "claude"
      ? model.id === id
      : localModelIdsMatch(model.id, id)
  );
}

export function isKnownClaudeModel(id: string): boolean {
  return LLM_MODELS.some((model) => model.provider === "claude" && model.id === id);
}

export function getCuratedLocalModels(): LlmModelEntry[] {
  return LLM_MODELS.filter((model) => model.provider === "ollama");
}
