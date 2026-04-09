import { useEffect, useState } from "react";
import {
  LLM_MODELS,
  classifyModelClient,
  findModelEntry,
  type LlmModelEntry,
  type LlmProviderKind,
} from "../constants";
import { api } from "../ipc-client";

interface ModelDropdownProps {
  /** Current model id (free-form string — may be in the catalog or not). */
  value: string;
  onChange: (next: string) => void;
  /**
   * Restrict the picker to one provider. Used by the Settings → Local
   * models card. Default: show both.
   */
  providerFilter?: LlmProviderKind;
  /**
   * If provided, the picker shows the user's actually-installed local
   * models at the top of the list with a "✓ installed" badge. The Local
   * models card uses this to encourage reuse of pulled weights and avoid
   * accidental duplicate downloads.
   */
  installedLocalModels?: string[];
  /** RAM in GB — disables local picks the user's machine can't run. */
  totalRamGb?: number;
  /** Allow a free-form "Custom…" id input. Default: true. */
  allowCustom?: boolean;
}

/**
 * Shared model picker used by Settings (default model) and PromptsEditor
 * (per-prompt override). Renders cloud and local models in two opt-groups
 * with a small chip below the select indicating which kind is currently
 * selected, plus a one-click install path for local models that aren't
 * yet pulled.
 */
export function ModelDropdown({
  value,
  onChange,
  providerFilter,
  installedLocalModels,
  totalRamGb,
  allowCustom = true,
}: ModelDropdownProps) {
  const entries = LLM_MODELS.filter(
    (m) => !providerFilter || m.provider === providerFilter
  );
  const claudeEntries = entries.filter((m) => m.provider === "claude");
  const ollamaEntries = entries.filter((m) => m.provider === "ollama");

  const known = entries.some((m) => m.id === value);
  const [showCustom, setShowCustom] = useState(allowCustom && !!value && !known);

  // If the value flips to something we recognise (e.g. wizard reset),
  // collapse the custom input again so the dropdown is the source of truth.
  useEffect(() => {
    if (entries.some((m) => m.id === value)) {
      setShowCustom(false);
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSelectChange = (next: string) => {
    if (next === "__custom__") {
      setShowCustom(true);
      // Don't immediately overwrite — let the user type into the input.
      if (entries.some((m) => m.id === value)) onChange("");
    } else {
      setShowCustom(false);
      onChange(next);
    }
  };

  const selectValue = showCustom ? "__custom__" : known ? value : "__custom__";
  const currentKind: LlmProviderKind | undefined = value
    ? classifyModelClient(value)
    : undefined;
  const currentEntry = findModelEntry(value);
  const isLocal = currentKind === "ollama";
  const localInstalled =
    isLocal && installedLocalModels ? installedLocalModels.includes(value) : false;

  return (
    <>
      <select value={selectValue} onChange={(e) => onSelectChange(e.target.value)}>
        {claudeEntries.length > 0 && (
          <optgroup label="Claude (cloud)">
            {claudeEntries.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </optgroup>
        )}
        {ollamaEntries.length > 0 && (
          <optgroup label="Local (Ollama)">
            {ollamaEntries.map((m) => (
              <LocalOption
                key={m.id}
                entry={m}
                installed={installedLocalModels?.includes(m.id) ?? false}
                totalRamGb={totalRamGb}
              />
            ))}
          </optgroup>
        )}
        {allowCustom && <option value="__custom__">Custom…</option>}
      </select>

      {showCustom && allowCustom && (
        <input
          style={{ marginTop: 6 }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="model id (e.g. claude-… or qwen3.5:9b)"
        />
      )}

      {/* Provider chip + install hint */}
      {value && currentKind && (
        <div className="row" style={{ marginTop: 6, alignItems: "center", gap: 8 }}>
          <span
            className="chip"
            data-kind={currentKind}
            style={{
              fontSize: 11,
              padding: "2px 8px",
              borderRadius: 999,
              background:
                currentKind === "claude" ? "var(--accent-bg, #2a3a5a)" : "var(--success-bg, #234d2a)",
              color: "var(--fg)",
            }}
          >
            {currentKind === "claude" ? "Cloud" : "Local"}
          </span>
          {currentEntry?.blurb && (
            <span className="muted" style={{ fontSize: 12 }}>
              {currentEntry.blurb}
            </span>
          )}
          {isLocal && installedLocalModels && !localInstalled && (
            <InstallHint model={value} />
          )}
        </div>
      )}
    </>
  );
}

function LocalOption({
  entry,
  installed,
  totalRamGb,
}: {
  entry: LlmModelEntry;
  installed: boolean;
  totalRamGb?: number;
}) {
  const tooBig =
    typeof totalRamGb === "number" &&
    typeof entry.minRamGb === "number" &&
    entry.minRamGb > totalRamGb;
  const sizeLabel = entry.sizeGb ? ` · ${entry.sizeGb} GB` : "";
  const installedLabel = installed ? " ✓ installed" : "";
  const ramWarn = tooBig ? ` · needs ${entry.minRamGb} GB RAM` : "";
  return (
    <option value={entry.id} disabled={tooBig}>
      {entry.label}
      {sizeLabel}
      {installedLabel}
      {ramWarn}
    </option>
  );
}

/**
 * Tiny inline "Install now" affordance for local models that aren't
 * pulled yet. Streams setup-llm:log into a small modal so the user can
 * watch the pull progress.
 */
function InstallHint({ model }: { model: string }) {
  const [busy, setBusy] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!logOpen) return;
    const unsub = api.on.setupLlmLog((line) => setLog((prev) => [...prev, line]));
    return () => unsub();
  }, [logOpen]);

  const onInstall = async () => {
    setBusy(true);
    setLog([]);
    setError(null);
    setLogOpen(true);
    try {
      await api.llm.setup({ model });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <span className="muted" style={{ fontSize: 12 }}>
        Not installed —
      </span>
      <button onClick={onInstall} disabled={busy}>
        {busy ? "Installing…" : "Install now"}
      </button>
      {logOpen && (
        <div className="modal-backdrop" onClick={() => !busy && setLogOpen(false)}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 640 }}
          >
            <h2>Pulling {model}</h2>
            <p className="muted">First-time download — runs in the background.</p>
            {log.length > 0 && <pre className="log-view">{log.join("\n")}</pre>}
            {error && (
              <div className="muted" style={{ color: "var(--danger)" }}>
                {error}
              </div>
            )}
            <div className="actions">
              <button onClick={() => setLogOpen(false)} disabled={busy}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
