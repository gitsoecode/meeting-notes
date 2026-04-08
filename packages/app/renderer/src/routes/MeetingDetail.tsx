import { useEffect, useMemo, useState } from "react";
import { api } from "../ipc-client";
import type {
  AppConfigDTO,
  PromptRow,
  RunDetail,
  PipelineProgressEvent,
} from "../../../shared/ipc";
import { MarkdownView } from "../components/MarkdownView";
import { MarkdownEditor } from "../components/MarkdownEditor";
import {
  PipelineStatus,
  applyProgress,
  type SectionStatus,
} from "../components/PipelineStatus";

interface MeetingDetailProps {
  runFolder: string;
  config: AppConfigDTO;
  onBack: () => void;
}

interface TabDef {
  id: string;
  label: string;
  filePath: string;
  editable: boolean;
}

export function MeetingDetail({ runFolder, config, onBack }: MeetingDetailProps) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [tabContents, setTabContents] = useState<Record<string, string>>({});
  const [reprocessOpen, setReprocessOpen] = useState(false);
  const [runPromptOpen, setRunPromptOpen] = useState(false);
  const [sections, setSections] = useState<SectionStatus[]>([]);

  const refresh = async () => {
    setLoading(true);
    try {
      const d = await api.runs.get(runFolder);
      setDetail(d);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    setTabContents({});
    setActiveTabId(null);
    setSections([]);
  }, [runFolder]);

  // Subscribe to progress events for live updates on reprocess runs.
  useEffect(() => {
    const unsub = api.on.pipelineProgress((event: PipelineProgressEvent) => {
      if (event.runFolder !== runFolder) return;
      setSections((prev) => applyProgress(prev, event));
      if (event.type === "run-complete" || event.type === "run-failed") {
        refresh();
      }
    });
    return () => unsub();
  }, [runFolder]);

  const tabs: TabDef[] = useMemo(() => {
    if (!detail) return [];
    const base: TabDef[] = [
      { id: "overview", label: "Overview", filePath: `${runFolder}/index.md`, editable: false },
      { id: "notes", label: "Notes", filePath: `${runFolder}/notes.md`, editable: true },
      { id: "transcript", label: "Transcript", filePath: `${runFolder}/transcript.md`, editable: false },
    ];
    const seen = new Set(base.map((t) => t.filePath));
    for (const f of detail.files) {
      if (seen.has(f.path)) continue;
      if (!f.name.endsWith(".md")) continue;
      if (f.name === "Dashboard.md") continue;
      const id = f.name.replace(/\.md$/, "");
      base.push({
        id,
        label: id.charAt(0).toUpperCase() + id.slice(1),
        filePath: f.path,
        editable: false,
      });
    }
    return base;
  }, [detail, runFolder]);

  useEffect(() => {
    if (!activeTabId && tabs.length > 0) {
      setActiveTabId(tabs[0].id);
    }
  }, [tabs, activeTabId]);

  // Load content for the active tab lazily.
  useEffect(() => {
    if (!activeTabId) return;
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    if (tabContents[tab.id] != null) return;
    api.runs
      .readFile(tab.filePath)
      .then((content) =>
        setTabContents((prev) => ({ ...prev, [tab.id]: content }))
      )
      .catch(() =>
        setTabContents((prev) => ({ ...prev, [tab.id]: "_(file not found)_" }))
      );
  }, [activeTabId, tabs, tabContents]);

  const onNotesChange = (value: string) => {
    setTabContents((prev) => ({ ...prev, notes: value }));
  };

  const onNotesBlur = () => {
    const notes = tabContents.notes;
    if (notes == null) return;
    api.runs.writeFile(`${runFolder}/notes.md`, notes).catch(() => {});
  };

  const onOpenFinder = () => api.runs.openInFinder(runFolder);
  const onDelete = async () => {
    if (!confirm("Delete this meeting and all its files?")) return;
    await api.runs.deleteRun(runFolder);
    onBack();
  };

  if (loading) return <div className="muted">Loading…</div>;
  if (error) return <div className="muted" style={{ color: "var(--danger)" }}>{error}</div>;
  if (!detail) return <div className="muted">Meeting not found.</div>;

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const content = activeTab ? tabContents[activeTab.id] ?? "" : "";

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <button onClick={onBack} style={{ marginBottom: 12 }}>
            ← Back
          </button>
          <h1 className="section-title">{detail.title}</h1>
          <p className="section-subtitle">
            {new Date(detail.started || detail.date).toLocaleString()} ·{" "}
            {detail.duration_minutes != null ? `${detail.duration_minutes.toFixed(1)}m` : "—"} ·{" "}
            <span className={`status-pill ${detail.status}`}>{detail.status}</span>
          </p>
        </div>
        <div className="row">
          <button onClick={() => setReprocessOpen(true)}>Reprocess…</button>
          <button onClick={() => setRunPromptOpen(true)}>Run prompt…</button>
          <button onClick={onOpenFinder}>Open folder</button>
          <button className="danger" onClick={onDelete}>Delete</button>
        </div>
      </div>

      {sections.length > 0 && (
        <PipelineStatus sections={sections} title="Live processing" />
      )}

      <div className="tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`tab ${activeTabId === t.id ? "active" : ""}`}
            onClick={() => setActiveTabId(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab?.editable ? (
        <div style={{ height: "60vh" }}>
          <MarkdownEditor
            value={content}
            onChange={onNotesChange}
            onBlur={onNotesBlur}
          />
        </div>
      ) : (
        <MarkdownView source={content} />
      )}

      {config.obsidian_integration.enabled && activeTab && (
        <div style={{ marginTop: 12 }}>
          <button
            onClick={() => api.runs.openInObsidian(activeTab.filePath).catch(() => {})}
          >
            Open in Obsidian
          </button>
        </div>
      )}

      {reprocessOpen && (
        <ReprocessModal
          runFolder={runFolder}
          onClose={() => setReprocessOpen(false)}
          onDone={() => {
            setReprocessOpen(false);
            refresh();
          }}
        />
      )}

      {runPromptOpen && (
        <RunPromptModal
          runFolder={runFolder}
          onClose={() => setRunPromptOpen(false)}
          onDone={() => {
            setRunPromptOpen(false);
            refresh();
          }}
        />
      )}
    </>
  );
}

function ReprocessModal({
  runFolder,
  onClose,
  onDone,
}: {
  runFolder: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [skipComplete, setSkipComplete] = useState(true);
  const [autoOnly, setAutoOnly] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onRun = async () => {
    setRunning(true);
    try {
      await api.runs.reprocess({
        runFolder,
        onlyFailed,
        skipComplete,
        autoOnly,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Reprocess meeting</h2>
        <p className="muted">Select which sections to regenerate.</p>
        <div className="checkbox-row">
          <input
            type="checkbox"
            checked={onlyFailed}
            onChange={(e) => setOnlyFailed(e.target.checked)}
            id="only-failed"
          />
          <label htmlFor="only-failed" style={{ marginBottom: 0 }}>
            Only rerun sections that failed last time
          </label>
        </div>
        <div className="checkbox-row">
          <input
            type="checkbox"
            checked={skipComplete}
            onChange={(e) => setSkipComplete(e.target.checked)}
            id="skip-complete"
          />
          <label htmlFor="skip-complete" style={{ marginBottom: 0 }}>
            Skip sections that are already complete
          </label>
        </div>
        <div className="checkbox-row">
          <input
            type="checkbox"
            checked={!autoOnly}
            onChange={(e) => setAutoOnly(!e.target.checked)}
            id="include-manual"
          />
          <label htmlFor="include-manual" style={{ marginBottom: 0 }}>
            Include manual prompts (off = auto-only)
          </label>
        </div>
        {error && <div className="muted" style={{ color: "var(--danger)" }}>{error}</div>}
        <div className="actions">
          <button onClick={onClose} disabled={running}>Cancel</button>
          <button className="primary" onClick={onRun} disabled={running}>
            {running ? "Running…" : "Run"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RunPromptModal({
  runFolder,
  onClose,
  onDone,
}: {
  runFolder: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.prompts.list().then((list) => {
      setPrompts(list);
      if (list.length > 0) setSelectedId(list[0].id);
    });
  }, []);

  const onRun = async () => {
    if (!selectedId) return;
    setRunning(true);
    try {
      await api.runs.reprocess({
        runFolder,
        onlyIds: [selectedId],
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Run prompt</h2>
        <label>Prompt</label>
        <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
          {prompts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} {p.auto ? "" : "(manual)"}
            </option>
          ))}
        </select>
        {error && <div className="muted" style={{ color: "var(--danger)" }}>{error}</div>}
        <div className="actions">
          <button onClick={onClose} disabled={running}>Cancel</button>
          <button className="primary" onClick={onRun} disabled={running || !selectedId}>
            {running ? "Running…" : "Run"}
          </button>
        </div>
      </div>
    </div>
  );
}
