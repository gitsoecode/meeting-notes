import { listOllamaModels } from "@meeting-notes/engine";

const SUPPORTED_CLAUDE_MODELS = new Set([
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
]);

const LOCAL_MODEL_ALIASES: Record<string, string> = {
  "qwen3.5": "qwen3.5:9b",
  "qwen3.5:latest": "qwen3.5:9b",
};

function normalizeModelId(id: string | null | undefined): string | null {
  if (!id) return null;
  const trimmed = id.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("claude-")) return trimmed;
  const withoutLatest = trimmed.replace(/:latest$/, "");
  return LOCAL_MODEL_ALIASES[withoutLatest] ?? withoutLatest;
}

function localModelIdsMatch(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  const normalizedLeft = normalizeModelId(left);
  const normalizedRight = normalizeModelId(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft === normalizedRight;
}

function classifyAppModel(id: string): "claude" | "ollama" {
  return id.startsWith("claude-") ? "claude" : "ollama";
}

function isKnownClaudeModel(id: string): boolean {
  return SUPPORTED_CLAUDE_MODELS.has(id);
}

export function isPromptModelSelectionSupported(
  model: string | null | undefined,
  installedLocalModels: ReadonlyArray<string | { toString(): string }>
): { ok: true; model: string | null } | { ok: false; error: string } {
  const normalized = normalizeModelId(model);
  if (!normalized) return { ok: true, model: null };

  if (classifyAppModel(normalized) === "claude") {
    if (!isKnownClaudeModel(normalized)) {
      return {
        ok: false,
        error: `Claude model "${normalized}" is not supported in this app.`,
      };
    }
    return { ok: true, model: normalized };
  }

  const installedMatch = installedLocalModels.find((modelId) =>
    localModelIdsMatch(String(modelId), normalized)
  );
  if (!installedMatch) {
    return {
      ok: false,
      error: `Local model "${normalized}" is not installed yet. Install it in Settings before assigning it to a prompt.`,
    };
  }

  return { ok: true, model: String(installedMatch) };
}

interface ValidatePromptModelSelectionOptions {
  baseUrl?: string;
  installedLocalModels?: ReadonlyArray<string | { toString(): string }>;
}

export async function validatePromptModelSelection(
  model: string | null | undefined,
  options: ValidatePromptModelSelectionOptions = {}
): Promise<string | null> {
  const normalized = normalizeModelId(model);
  if (!normalized) return null;

  let installed = options.installedLocalModels;
  if (!installed && classifyAppModel(normalized) === "ollama") {
    try {
      installed = (await listOllamaModels(options.baseUrl)).map((entry) => entry.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not verify installed local models from Ollama. ${message}`
      );
    }
  }

  const result = isPromptModelSelectionSupported(model, installed ?? []);
  if (!result.ok) throw new Error(result.error);
  return result.model;
}

export function getRunStartedSortValue(value: unknown, fallback: string): number {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  const fallbackParsed = Date.parse(fallback);
  return Number.isFinite(fallbackParsed) ? fallbackParsed : 0;
}
