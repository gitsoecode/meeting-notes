import type { AppConfigDTO, PromptRow } from "../../../shared/ipc";
import { classifyModelClient, findModelEntry } from "../constants";

export function getDefaultPromptModel(config: AppConfigDTO | null | undefined): string | null {
  if (!config) return null;
  return config.llm_provider === "ollama"
    ? config.ollama.model
    : config.llm_provider === "openai"
    ? config.openai.model
    : config.claude.model;
}

export interface PromptModelSummary {
  id: string | null;
  label: string;
  providerLabel: string | null;
  rawId: string | null;
}

export function getPromptModelSummary(
  prompt: Pick<PromptRow, "model"> | null | undefined,
  defaultModel: string | null | undefined
): PromptModelSummary {
  const effectiveModel = prompt?.model ?? defaultModel ?? null;
  if (!effectiveModel) {
    return {
      id: null,
      label: "Model unavailable",
      providerLabel: null,
      rawId: null,
    };
  }

  const entry = findModelEntry(effectiveModel);
  const provider = classifyModelClient(effectiveModel);

  return {
    id: effectiveModel,
    label: entry?.label ?? effectiveModel,
    providerLabel:
      provider === "ollama"
        ? "Local model"
        : provider === "openai"
        ? "OpenAI"
        : "Claude",
    rawId: entry?.id === effectiveModel ? null : effectiveModel,
  };
}
