import { FolderOpen, RefreshCw } from "lucide-react";
import type { OllamaRuntimeDTO } from "../../../../shared/ipc";
import { Button } from "../ui/button";
import { StackedMeter } from "../ui/meter";
import { cn } from "../../lib/utils";

interface RuntimeSectionProps {
  runtime: OllamaRuntimeDTO | null;
  onRefresh: () => void;
  onRevealOllamaLog: () => void;
}

export function RuntimeSection({ runtime, onRefresh, onRevealOllamaLog }: RuntimeSectionProps) {
  const available = runtime?.available === true;
  const baseUrl = "http://127.0.0.1:11434";
  const sourceLabel = formatSource(runtime?.source);

  return (
    <section className="space-y-4" aria-label="Runtime">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-base font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
            Runtime
          </h3>
          <div className="flex items-center gap-2 text-sm" data-testid="runtime-status">
            <span
              className={cn(
                "inline-block h-2 w-2 rounded-full",
                available
                  ? "bg-[var(--success,#10b981)]"
                  : "bg-[var(--error,#ef4444)]"
              )}
              aria-hidden="true"
            />
            {available ? (
              <span className="text-[var(--text-primary)]">
                Running on {baseUrl}
                {sourceLabel ? (
                  <span className="text-[var(--text-secondary)]"> · {sourceLabel}</span>
                ) : null}
              </span>
            ) : (
              <span className="text-[var(--text-primary)]">
                {runtime?.error ?? "Ollama is unavailable"}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onRevealOllamaLog} aria-label="Reveal ollama.log">
            <FolderOpen className="h-3.5 w-3.5" />
            Reveal ollama.log
          </Button>
          <Button variant="ghost" size="sm" onClick={onRefresh} aria-label="Refresh runtime">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2" data-testid="runtime-models">
          <div className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
            Loaded models
          </div>
          {!available ? (
            <div className="text-sm text-[var(--text-secondary)]">—</div>
          ) : runtime!.models.length === 0 ? (
            <div className="text-sm text-[var(--text-secondary)]">No models loaded.</div>
          ) : (
            <ul className="space-y-1.5">
              {runtime!.models.map((model) => (
                <li
                  key={`${model.model}-${model.expires_at ?? "loaded"}`}
                  className="text-sm"
                >
                  <div className="text-[var(--text-primary)]">
                    {model.name ?? model.model}
                  </div>
                  <div className="text-xs text-[var(--text-secondary)]">
                    {model.details?.parameter_size ?? "?"} ·{" "}
                    {model.details?.quantization_level ?? "?"} ·{" "}
                    {formatBytes(model.size_vram)} VRAM
                    {model.expires_at ? ` · ${formatExpiresIn(model.expires_at)}` : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
            Memory pressure
          </div>
          {runtime?.systemMemory ? (
            <MemoryMeter memory={runtime.systemMemory} />
          ) : (
            <div className="text-sm text-[var(--text-secondary)]">—</div>
          )}
        </div>
      </div>
    </section>
  );
}

function formatSource(source: OllamaRuntimeDTO["source"]): string | null {
  switch (source) {
    case "system-running":
      return "system";
    case "system-spawned":
      return "system (managed)";
    case "bundled-spawned":
      return "bundled";
    default:
      return null;
  }
}

function formatBytes(value?: number): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatExpiresIn(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "expires soon";
  const diffMs = time - Date.now();
  if (diffMs <= 0) return "expired";
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "<1m left";
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h left`;
}

function MemoryMeter({
  memory,
}: {
  memory: { totalBytes: number; freeBytes: number; ollamaVramBytes: number };
}) {
  const totalGb = memory.totalBytes / 1024 ** 3;
  const usedGb = (memory.totalBytes - memory.freeBytes) / 1024 ** 3;
  const ollamaGb = memory.ollamaVramBytes / 1024 ** 3;
  const otherGb = Math.max(0, usedGb - ollamaGb);
  const usedPct = totalGb > 0 ? (usedGb / totalGb) * 100 : 0;
  const pressure: "low" | "medium" | "high" =
    usedPct > 90 ? "high" : usedPct > 75 ? "medium" : "low";
  const pressureColor =
    pressure === "high"
      ? "var(--error, #ef4444)"
      : pressure === "medium"
        ? "var(--warning, #f59e0b)"
        : "var(--accent, #2d6b3f)";

  const segments = [];
  if (ollamaGb > 0) {
    segments.push({
      value: ollamaGb,
      color: pressureColor,
      label: `Ollama ${ollamaGb.toFixed(1)} GB`,
    });
  }
  segments.push({
    value: otherGb,
    color: "#3b82f6",
    label: `Other ${otherGb.toFixed(1)} GB`,
  });

  return (
    <div className="space-y-1.5">
      <StackedMeter
        size="sm"
        max={totalGb}
        valueLabel={`${usedGb.toFixed(1)} / ${totalGb.toFixed(0)} GB used`}
        segments={segments}
      />
      <div className="text-xs text-[var(--text-secondary)]">
        Pressure: <span className="text-[var(--text-primary)]">{pressure}</span>
      </div>
    </div>
  );
}
