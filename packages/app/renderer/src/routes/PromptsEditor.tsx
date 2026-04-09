import { useEffect, useMemo, useState } from "react";
import { api } from "../ipc-client";
import type { PromptRow, RunSummary } from "../../../shared/ipc";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { LLM_MODELS, relativeDateLabel } from "../constants";
import { ModelDropdown } from "../components/ModelDropdown";

export function PromptsEditor() {
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftFilename, setDraftFilename] = useState("");
  const [draftModel, setDraftModel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runAgainstOpen, setRunAgainstOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await api.prompts.list();
      setPrompts(list);
      const target =
        activeId != null
          ? list.find((p) => p.id === activeId) ?? list[0] ?? null
          : list[0] ?? null;
      if (target) {
        setActiveId(target.id);
        setDraftBody(target.body);
        setDraftLabel(target.label);
        setDraftFilename(target.filename);
        setDraftModel(target.model);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = prompts.find((p) => p.id === activeId) ?? null;

  const onSelect = (p: PromptRow) => {
    setActiveId(p.id);
    setDraftBody(p.body);
    setDraftLabel(p.label);
    setDraftFilename(p.filename);
    setDraftModel(p.model);
  };

  const onSave = async () => {
    if (!active) return;
    setSaving(true);
    try {
      await api.prompts.save(active.id, draftBody, {
        label: draftLabel,
        filename: draftFilename,
        model: draftModel,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const onToggleEnabled = async (p: PromptRow) => {
    await api.prompts.enable(p.id, !p.enabled);
    refresh();
  };

  const onSetAuto = async (p: PromptRow, auto: boolean) => {
    if (p.auto === auto) return;
    await api.prompts.setAuto(p.id, auto);
    refresh();
  };

  const onReset = async () => {
    if (!active || !active.builtin) return;
    if (!confirm(`Reset "${active.label}" to its factory default?`)) return;
    await api.prompts.resetToDefault(active.id);
    refresh();
  };

  const onOpenFinder = () => api.prompts.openInFinder();

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 className="section-title">Prompts</h1>
          <p className="section-subtitle">
            Prompts run in parallel against the transcript. Auto prompts run on every meeting;
            manual prompts only run when you trigger them.
          </p>
        </div>
        <div className="row">
          <button onClick={() => setNewOpen(true)}>New prompt</button>
          <button onClick={onOpenFinder}>Open in Finder</button>
        </div>
      </div>

      {error && <div className="muted" style={{ color: "var(--danger)" }}>{error}</div>}
      {loading ? (
        <div className="muted">Loading…</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 20 }}>
          <div className="card" style={{ padding: 0 }}>
            {prompts.map((p) => (
              <div
                key={p.id}
                onClick={() => onSelect(p)}
                className={`prompt-list-row ${activeId === p.id ? "active" : ""}`}
              >
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong>{p.label}</strong>
                  {p.builtin && <span className="status-pill">builtin</span>}
                </div>
                <div className="muted" style={{ fontSize: 11 }}>
                  {p.id} · {p.filename}
                </div>
                <div className="row" style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      onChange={() => onToggleEnabled(p)}
                    />
                    <span className="slider" />
                  </label>
                  <span className="muted" style={{ fontSize: 11 }}>
                    {p.enabled ? "enabled" : "disabled"}
                  </span>
                </div>
                <div
                  className="segmented"
                  style={{ marginTop: 8 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className={p.auto ? "active" : ""}
                    onClick={() => onSetAuto(p, true)}
                  >
                    Auto
                  </button>
                  <button
                    type="button"
                    className={!p.auto ? "active" : ""}
                    onClick={() => onSetAuto(p, false)}
                  >
                    Manual
                  </button>
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                  {p.auto
                    ? "Runs after every meeting"
                    : "Only runs when you trigger it"}
                </div>
              </div>
            ))}
          </div>
          {active && (
            <div className="column">
              <div className="card">
                <label>Label</label>
                <input
                  value={draftLabel}
                  onChange={(e) => setDraftLabel(e.target.value)}
                />
                <label style={{ marginTop: 12 }}>Filename (output)</label>
                <input
                  value={draftFilename}
                  onChange={(e) => setDraftFilename(e.target.value)}
                />
                <label style={{ marginTop: 12 }}>Model</label>
                <ModelSelect value={draftModel} onChange={setDraftModel} />
                <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                  Pick "Default" to use the model from Settings. Override per-prompt
                  if you want a smarter or faster model just for this output.
                </div>
              </div>
              <div className="card" style={{ padding: 0, height: 400 }}>
                <MarkdownEditor value={draftBody} onChange={setDraftBody} />
              </div>
              <div className="row">
                <button className="primary" onClick={onSave} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </button>
                <button onClick={() => setRunAgainstOpen(true)}>Run against meeting…</button>
                {active.builtin && <button onClick={onReset}>Reset to default</button>}
              </div>
            </div>
          )}
        </div>
      )}

      {runAgainstOpen && active && (
        <RunAgainstMeetingModal
          promptId={active.id}
          promptLabel={active.label}
          onClose={() => setRunAgainstOpen(false)}
        />
      )}

      {newOpen && (
        <NewPromptModal
          onClose={() => setNewOpen(false)}
          onCreated={(id) => {
            setNewOpen(false);
            setActiveId(id);
            refresh();
          }}
        />
      )}
    </>
  );
}

/**
 * Per-prompt model picker. `null` means "fall back to the default in
 * Settings" — represented in the dropdown as the first option. Anything
 * else is a concrete model id (cloud or local) handled by the shared
 * ModelDropdown.
 */
function ModelSelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const useDefault = value == null;
  return (
    <div>
      <label style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
        <input
          type="checkbox"
          checked={useDefault}
          onChange={(e) => onChange(e.target.checked ? null : LLM_MODELS[0].id)}
        />
        <span>Use default model from Settings</span>
      </label>
      {!useDefault && (
        <ModelDropdown value={value ?? ""} onChange={(next) => onChange(next || null)} />
      )}
    </div>
  );
}

function RunAgainstMeetingModal({
  promptId,
  promptLabel,
  onClose,
}: {
  promptId: string;
  promptLabel: string;
  onClose: () => void;
}) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    api.runs.list().then(setRuns);
  }, []);

  const sortedFiltered = useMemo(() => {
    const s = search.trim().toLowerCase();
    const filtered = s
      ? runs.filter((r) => r.title.toLowerCase().includes(s))
      : runs;
    const sorted = [...filtered].sort((a, b) => {
      const ta = Date.parse(a.started || a.date) || 0;
      const tb = Date.parse(b.started || b.date) || 0;
      return tb - ta;
    });
    return sorted;
  }, [runs, search]);

  const visibleRuns =
    search || showAll ? sortedFiltered : sortedFiltered.slice(0, 10);

  const toggle = (folder: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  };

  const onRun = async () => {
    setRunning(true);
    try {
      await api.runs.bulkReprocess({
        runFolders: Array.from(selected),
        onlyIds: [promptId],
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 640 }}>
        <h2>Run "{promptLabel}" against meetings</h2>
        <input
          placeholder="Search titles…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: 10 }}
        />
        <div className="meeting-picker">
          {visibleRuns.length === 0 ? (
            <div className="muted">No meetings match.</div>
          ) : (
            visibleRuns.map((r) => {
              const isSelected = selected.has(r.folder_path);
              return (
                <button
                  type="button"
                  key={r.folder_path}
                  className={`meeting-picker-row ${isSelected ? "selected" : ""}`}
                  onClick={() => toggle(r.folder_path)}
                >
                  <span className="meeting-picker-check">
                    {isSelected ? "✓" : ""}
                  </span>
                  <span className="meeting-picker-title">{r.title}</span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {relativeDateLabel(r.started || r.date)}
                  </span>
                  <span className={`status-pill ${r.status}`}>{r.status}</span>
                </button>
              );
            })
          )}
        </div>
        {!search && !showAll && sortedFiltered.length > 10 && (
          <button
            onClick={() => setShowAll(true)}
            style={{ marginTop: 8 }}
          >
            Show all {sortedFiltered.length}
          </button>
        )}
        {error && <div className="muted" style={{ color: "var(--danger)" }}>{error}</div>}
        <div className="actions">
          <button onClick={onClose} disabled={running}>Cancel</button>
          <button
            className="primary"
            onClick={onRun}
            disabled={running || selected.size === 0}
          >
            {running ? "Running…" : `Run on ${selected.size}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function NewPromptModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [filename, setFilename] = useState("");
  const [body, setBody] = useState("Write a brief recap of the meeting.");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCreate = async () => {
    if (!id || !label || !filename) {
      setError("All fields required");
      return;
    }
    setCreating(true);
    try {
      await api.prompts.create(id, label, filename, body);
      onCreated(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New prompt</h2>
        <label>ID (slug, unique)</label>
        <input value={id} onChange={(e) => setId(e.target.value)} placeholder="coaching" />
        <label style={{ marginTop: 12 }}>Label</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Coaching notes" />
        <label style={{ marginTop: 12 }}>Filename</label>
        <input
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          placeholder="coaching.md"
        />
        <label style={{ marginTop: 12 }}>Body</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          style={{ fontFamily: "var(--font-mono)" }}
        />
        {error && <div className="muted" style={{ color: "var(--danger)" }}>{error}</div>}
        <div className="actions">
          <button onClick={onClose} disabled={creating}>Cancel</button>
          <button className="primary" onClick={onCreate} disabled={creating}>
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
