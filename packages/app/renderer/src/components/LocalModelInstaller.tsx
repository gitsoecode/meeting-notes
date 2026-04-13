import { useMemo, useState } from "react";
import {
  LLM_MODELS,
  findModelEntry,
  localModelIdsMatch,
  normalizeModelId,
  type LlmModelEntry,
} from "../constants";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

interface LocalModelInstallerProps {
  installedModels: string[];
  /** Called when the user wants to install a model. Parent shows confirm dialog + runs install. */
  onInstall: (model: string, sizeGb: number | undefined) => void;
  /** Called when the user wants to remove an installed model. Parent shows confirm dialog. */
  onRemove: (model: string) => void;
}

const OTHER_VALUE = "__other__";

export function LocalModelInstaller({
  installedModels,
  onInstall,
  onRemove,
}: LocalModelInstallerProps) {
  const [selected, setSelected] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  const normalizedInstalled = useMemo(
    () => installedModels.map((m) => normalizeModelId(m)).filter(Boolean) as string[],
    [installedModels],
  );

  const isInstalled = (id: string) =>
    normalizedInstalled.some((inst) => localModelIdsMatch(inst, id));

  // Curated Ollama models from the catalog
  const curatedModels = useMemo(
    () => LLM_MODELS.filter((m) => m.provider === "ollama"),
    [],
  );

  // Installed models not in the curated list
  const extraInstalled = useMemo(() => {
    return installedModels.filter(
      (m) => !curatedModels.some((c) => localModelIdsMatch(c.id, m)),
    );
  }, [installedModels, curatedModels]);

  const onSelectChange = (value: string) => {
    if (value === OTHER_VALUE) {
      setShowCustom(true);
      setSelected("");
      return;
    }
    setShowCustom(false);
    setSelected(value);
  };

  const handleInstall = () => {
    const model = showCustom ? customModel.trim() : selected;
    if (!model) return;
    const entry = findModelEntry(model);
    onInstall(model, entry?.sizeGb);
  };

  const selectedIsInstalled = selected && isInstalled(selected);
  const customIsInstalled = showCustom && customModel.trim() && isInstalled(customModel.trim());
  const canInstall = showCustom
    ? customModel.trim() && !customIsInstalled
    : selected && !selectedIsInstalled;

  // All installed models for the manage section
  const allInstalled = useMemo(() => {
    const result: Array<{ id: string; label: string; entry?: LlmModelEntry }> = [];
    for (const m of installedModels) {
      const entry = findModelEntry(m);
      result.push({ id: m, label: entry?.label ?? m, entry: entry ?? undefined });
    }
    return result;
  }, [installedModels]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium text-[var(--text-secondary)]">Install a model</label>
        <div className="flex gap-2">
          <Select value={showCustom ? OTHER_VALUE : selected} onValueChange={onSelectChange}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Select a model…" />
            </SelectTrigger>
            <SelectContent>
              {curatedModels.map((m) => {
                const installed = isInstalled(m.id);
                const sizeLabel = m.sizeGb ? ` · ${m.sizeGb} GB` : "";
                return (
                  <SelectItem key={m.id} value={m.id}>
                    <span>
                      {m.label}{sizeLabel}
                      {installed && (
                        <span className="ml-1.5 text-xs text-[var(--success)]">Installed</span>
                      )}
                    </span>
                  </SelectItem>
                );
              })}
              {extraInstalled.map((m) => (
                <SelectItem key={m} value={m}>
                  <span>
                    {m}
                    <span className="ml-1.5 text-xs text-[var(--success)]">Installed</span>
                  </span>
                </SelectItem>
              ))}
              <SelectItem value={OTHER_VALUE}>Other…</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={handleInstall} disabled={!canInstall}>
            Install
          </Button>
        </div>

        {showCustom && (
          <div className="space-y-1.5">
            <Input
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              placeholder="e.g. deepseek-r1:8b"
            />
            <p className="text-xs text-[var(--text-tertiary)]">
              Enter an Ollama model name. Browse available models at{" "}
              <span className="font-medium text-[var(--text-secondary)]">ollama.com/library</span>.
            </p>
          </div>
        )}

        {!showCustom && selected && (
          <p className="text-xs text-[var(--text-tertiary)]">
            {selectedIsInstalled
              ? "This model is already installed."
              : findModelEntry(selected)?.blurb ?? ""}
          </p>
        )}
      </div>

      {allInstalled.length > 0 && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-[var(--text-secondary)]">Installed models</label>
          <div className="space-y-1">
            {allInstalled.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1.5 text-sm"
              >
                <span className="truncate text-[var(--text-primary)]">{m.label}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-[var(--error)] hover:bg-[var(--error-muted)] hover:text-[var(--error)]"
                  onClick={() => onRemove(m.id)}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
