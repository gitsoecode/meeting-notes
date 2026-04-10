import type { PromptRow } from "../../../shared/ipc";
import { getPromptModelSummary } from "../lib/prompt-metadata";
import { Badge } from "./ui/badge";

interface PromptRunSummaryProps {
  prompt: PromptRow | null;
  defaultModel: string | null;
}

export function PromptRunSummary({ prompt, defaultModel }: PromptRunSummaryProps) {
  if (!prompt) return null;

  const model = getPromptModelSummary(prompt, defaultModel);
  const hasDescription = Boolean(prompt.description?.trim());

  return (
    <div
      className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)]/40 p-4"
      data-testid="prompt-run-summary"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[var(--text-primary)]">{prompt.label}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant={prompt.auto ? "accent" : "neutral"}>
              {prompt.auto ? "Auto-run" : "Manual"}
            </Badge>
            {model.providerLabel ? <Badge variant="info">{model.providerLabel}</Badge> : null}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
            Model
          </div>
          <div className="text-sm font-medium text-[var(--text-primary)]">{model.label}</div>
          {model.rawId ? (
            <div className="font-mono text-xs text-[var(--text-tertiary)]">{model.rawId}</div>
          ) : null}
        </div>
        <div className="space-y-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
            Description
          </div>
          {hasDescription ? (
            <div className="text-sm leading-6 text-[var(--text-secondary)]">
              {prompt.description}
            </div>
          ) : (
            <div className="text-sm text-[var(--text-tertiary)]">
              No description yet. Add one in Prompt Library under Details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
