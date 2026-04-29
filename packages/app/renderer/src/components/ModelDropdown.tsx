import { useEffect, useMemo, useState } from "react";
import {
  LLM_MODELS,
  classifyModelClient,
  findModelEntry,
  localModelIdsMatch,
  normalizeModelId,
  type LlmModelEntry,
  type LlmProviderKind,
} from "../constants";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "./ui/select";

interface ModelDropdownProps {
  value: string;
  onChange: (next: string) => void;
  providerFilter?: LlmProviderKind;
  installedLocalModels?: string[];
  totalRamGb?: number;
  allowCustom?: boolean;
  localMode?: "all" | "installed-only";
  /** Which cloud providers have a working API key configured */
  availableKeys?: { claude?: boolean; openai?: boolean };
  /**
   * When true, uninstalled Ollama models are still selectable. Default
   * (false) preserves the Settings behavior — you can't make an
   * uninstalled model your default. The wizard sets this to true because
   * the user is *choosing what to install*, not switching defaults.
   */
  selectableWhenUninstalled?: boolean;
  /**
   * Render a "recommended" pill next to these models' option labels.
   * Driven by the caller so the recommendation logic stays in one place
   * (recommendedLocalModelIds) and this component stays presentational.
   */
  recommendedIds?: string[];
  className?: string;
  triggerClassName?: string;
  triggerTestId?: string;
}

export function ModelDropdown({
  value,
  onChange,
  providerFilter,
  installedLocalModels,
  totalRamGb,
  allowCustom = true,
  localMode = "all",
  availableKeys,
  selectableWhenUninstalled = false,
  recommendedIds,
  className,
  triggerClassName,
  triggerTestId,
}: ModelDropdownProps) {
  const normalizedInstalled = useMemo(
    () => (installedLocalModels ?? []).map((m) => normalizeModelId(m)).filter(Boolean),
    [installedLocalModels]
  );

  const entries = useMemo(() => {
    const base = LLM_MODELS.filter(
      (m) => !providerFilter || m.provider === providerFilter
    );
    if (providerFilter === "claude") return base;

    const extra: LlmModelEntry[] = [];
    for (const installed of installedLocalModels ?? []) {
      const norm = normalizeModelId(installed);
      if (!norm) continue;
      const alreadyKnown = base.some(
        (m) => m.provider === "ollama" && localModelIdsMatch(m.id, norm)
      );
      if (alreadyKnown) continue;
      extra.push({
        id: installed,
        label: installed,
        provider: "ollama",
        blurb: "Installed local model detected from Ollama.",
      });
    }
    return [...base, ...extra];
  }, [installedLocalModels, providerFilter]);

  const claudeEntries = entries.filter((m) => m.provider === "claude");
  const openaiEntries = entries.filter((m) => m.provider === "openai");
  const ollamaEntries = entries.filter((m) => {
    if (m.provider !== "ollama") return false;
    if (localMode === "installed-only" && installedLocalModels) {
      return normalizedInstalled.some((inst) => localModelIdsMatch(inst, m.id));
    }
    return true;
  });

  const known = entries.some((m) =>
    m.provider === "claude" || m.provider === "openai" ? m.id === value : localModelIdsMatch(m.id, value)
  );
  const [showCustom, setShowCustom] = useState(allowCustom && !!value && !known);

  useEffect(() => {
    if (
      entries.some((m) =>
        m.provider === "claude" || m.provider === "openai" ? m.id === value : localModelIdsMatch(m.id, value)
      )
    ) {
      setShowCustom(false);
    }
  }, [entries, value]);

  const onSelectChange = (next: string) => {
    if (next === "__custom__") {
      setShowCustom(true);
      if (known) onChange("");
      return;
    }
    setShowCustom(false);
    onChange(next);
  };

  const selectValue = showCustom ? "__custom__" : known ? value : "";
  const selectedEntry = useMemo(() => findModelEntry(value), [value]);
  const selectedLabel = showCustom
    ? "Custom model"
    : (selectedEntry?.label ?? value.trim()) || "Select a model";

  const isInstalled = (model: LlmModelEntry) =>
    normalizedInstalled.some((inst) => localModelIdsMatch(inst, model.id));

  const tooBig = (model: LlmModelEntry) =>
    typeof totalRamGb === "number" &&
    typeof model.minRamGb === "number" &&
    model.minRamGb > totalRamGb;

  return (
    <div className={className}>
      <Select value={selectValue} onValueChange={onSelectChange}>
        <SelectTrigger className={triggerClassName} data-testid={triggerTestId}>
          <span
            className={`min-w-0 flex-1 truncate text-left ${value ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}
          >
            {selectedLabel}
          </span>
        </SelectTrigger>
        <SelectContent>
          {claudeEntries.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                Anthropic (Cloud){availableKeys && !availableKeys.claude ? " — no API key" : ""}
              </div>
              {claudeEntries.map((m) => {
                const noKey = availableKeys && !availableKeys.claude;
                return (
                  <SelectItem key={m.id} value={m.id} disabled={!!noKey}>
                    <span className={noKey ? "opacity-50" : ""}>{m.label}</span>
                  </SelectItem>
                );
              })}
            </>
          )}
          {openaiEntries.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                OpenAI (Cloud){availableKeys && !availableKeys.openai ? " — no API key" : ""}
              </div>
              {openaiEntries.map((m) => {
                const noKey = availableKeys && !availableKeys.openai;
                return (
                  <SelectItem key={m.id} value={m.id} disabled={!!noKey}>
                    <span className={noKey ? "opacity-50" : ""}>{m.label}</span>
                  </SelectItem>
                );
              })}
            </>
          )}
          {ollamaEntries.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                Local (Ollama)
              </div>
              {ollamaEntries.map((m) => {
                const installed = isInstalled(m);
                const tooLarge = tooBig(m);
                const disabled = (!installed && !selectableWhenUninstalled) || tooLarge;
                const recommended =
                  recommendedIds?.some((id) => localModelIdsMatch(m.id, id)) ?? false;
                const sizeLabel = m.sizeGb ? ` · ${m.sizeGb} GB` : "";
                const statusLabel = installed
                  ? " — Installed"
                  : selectableWhenUninstalled
                    ? ""
                    : " — Not installed";
                const ramWarn = tooLarge ? ` · needs ${m.minRamGb} GB RAM` : "";
                const recommendedTag =
                  recommended && !tooLarge ? " · recommended" : "";
                return (
                  <SelectItem
                    key={m.id}
                    value={m.id}
                    disabled={disabled}
                  >
                    <span className={disabled ? "opacity-50" : ""}>
                      {m.label}
                      {sizeLabel}
                      {statusLabel && (
                        <span className={`text-xs ${installed ? "text-[var(--success)]" : "text-[var(--text-tertiary)]"}`}>
                          {statusLabel}
                        </span>
                      )}
                      {recommendedTag}
                      {ramWarn}
                    </span>
                  </SelectItem>
                );
              })}
            </>
          )}
          {allowCustom && (
            <SelectItem value="__custom__">Custom…</SelectItem>
          )}
        </SelectContent>
      </Select>

      {showCustom && allowCustom && (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="model id (e.g. claude-… or qwen3.5)"
          className="mt-2"
        />
      )}

      {value && !showCustom && !selectableWhenUninstalled && classifyModelClient(value) === "ollama" && installedLocalModels && !normalizedInstalled.some((inst) => localModelIdsMatch(inst, value)) && (
        <p className="mt-2 text-xs text-[var(--text-tertiary)]">
          This model is not installed. Go to <strong>Settings → AI Models</strong> to pull it.
        </p>
      )}
    </div>
  );
}
