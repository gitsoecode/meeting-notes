import { useEffect, useState } from "react";
import { api } from "../ipc-client";
import type { PromptRow, RunSummary } from "../../../shared/ipc";
import { MarkdownEditor } from "../components/MarkdownEditor";

export function PromptsEditor() {
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftFilename, setDraftFilename] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runAgainstOpen, setRunAgainstOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await api.prompts.list();
      setPrompts(list);
      if (list.length > 0 && activeId == null) {
        setActiveId(list[0].id);
        setDraftBody(list[0].body);
        setDraftLabel(list[0].label);
        setDraftFilename(list[0].filename);
      } else if (activeId != null) {
        const found = list.find((p) => p.id === activeId);
        if (found) {
          setDraftBody(found.body);
          setDraftLabel(found.label);
          setDraftFilename(found.filename);
        }
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
  }, []);

  const active = prompts.find((p) => p.id === activeId) ?? null;

  const onSelect = (p: PromptRow) => {
    setActiveId(p.id);
    setDraftBody(p.body);
    setDraftLabel(p.label);
    setDraftFilename(p.filename);
  };

  const onSave = async () => {
    if (!active) return;
    setSaving(true);
    try {
      await api.prompts.save(active.id, draftBody, {
        label: draftLabel,
        filename: draftFilename,
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

  const onToggleAuto = async (p: PromptRow) => {
    await api.prompts.setAuto(p.id, !p.auto);
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
        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 20 }}>
          <div className="card" style={{ padding: 0 }}>
            {prompts.map((p) => (
              <div
                key={p.id}
                onClick={() => onSelect(p)}
                style={{
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--border)",
                  cursor: "pointer",
                  background: activeId === p.id ? "var(--bg-2)" : "transparent",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong>{p.label}</strong>
                  {p.builtin && <span className="status-pill">builtin</span>}
                </div>
                <div className="muted" style={{ fontSize: 11 }}>
                  {p.id} · {p.filename}
                </div>
                <div className="row" style={{ marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
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
                  <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>
                    {p.auto ? "auto" : "manual"}
                  </span>
                  <button
                    style={{ padding: "2px 8px", fontSize: 11 }}
                    onClick={() => onToggleAuto(p)}
                  >
                    toggle
                  </button>
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

  useEffect(() => {
    api.runs.list().then(setRuns);
  }, []);

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
        <div style={{ maxHeight: 360, overflowY: "auto", marginBottom: 12 }}>
          {runs.map((r) => (
            <div key={r.folder_path} className="checkbox-row">
              <input
                type="checkbox"
                checked={selected.has(r.folder_path)}
                onChange={() => toggle(r.folder_path)}
              />
              <span>
                {r.title} <span className="muted">({new Date(r.started || r.date).toLocaleDateString()})</span>
              </span>
            </div>
          ))}
        </div>
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
