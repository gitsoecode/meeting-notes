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
import { OverviewPanel } from "../components/OverviewPanel";
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

type TabKind = "overview" | "notes" | "transcript" | "prompts";

interface TabDef {
  id: TabKind;
  label: string;
}

interface PromptOutput {
  id: string;
  label: string;
  filePath: string;
  status?: string;
}

export function MeetingDetail({ runFolder, config, onBack }: MeetingDetailProps) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTabId, setActiveTabId] = useState<TabKind>("overview");
  const [tabContents, setTabContents] = useState<Record<string, string>>({});
  const [activePromptId, setActivePromptId] = useState<string | null>(null);
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
    setActiveTabId("overview");
    setActivePromptId(null);
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

  const promptOutputs: PromptOutput[] = useMemo(() => {
    if (!detail) return [];
    const manifest = (detail.manifest ?? {}) as {
      sections?: Record<string, { filename?: string; label?: string; status?: string; builtin?: boolean }>;
    };
    const sections = manifest.sections ?? {};
    const baseFilenames = new Set(["notes.md", "transcript.md", "index.md", "Dashboard.md"]);
    const out: PromptOutput[] = [];

    // First, anything declared in manifest.sections that isn't a base file.
    for (const [id, sec] of Object.entries(sections)) {
      if (!sec.filename) continue;
      if (baseFilenames.has(sec.filename)) continue;
      if (!sec.filename.endsWith(".md")) continue;
      out.push({
        id,
        label: sec.label ?? id,
        filePath: `${runFolder}/${sec.filename}`,
        status: sec.status,
      });
    }

    // Catch any extra .md files on disk not declared in the manifest.
    const seen = new Set(out.map((p) => p.filePath));
    for (const f of detail.files) {
      if (seen.has(f.path)) continue;
      if (!f.name.endsWith(".md")) continue;
      if (baseFilenames.has(f.name)) continue;
      const id = f.name.replace(/\.md$/, "");
      out.push({
        id,
        label: id.charAt(0).toUpperCase() + id.slice(1),
        filePath: f.path,
      });
    }
    return out;
  }, [detail, runFolder]);

  const tabs: TabDef[] = useMemo(() => {
    const base: TabDef[] = [
      { id: "overview", label: "Overview" },
      { id: "notes", label: "Notes" },
      { id: "transcript", label: "Transcript" },
    ];
    if (promptOutputs.length > 0) {
      base.push({ id: "prompts", label: "Prompts" });
    }
    return base;
  }, [promptOutputs]);

  // Default to the first prompt when entering the Prompts tab.
  useEffect(() => {
    if (activeTabId !== "prompts") return;
    if (activePromptId && promptOutputs.some((p) => p.id === activePromptId)) return;
    const firstComplete = promptOutputs.find((p) => p.status === "complete") ?? promptOutputs[0];
    setActivePromptId(firstComplete?.id ?? null);
  }, [activeTabId, promptOutputs, activePromptId]);

  // Lazily load file contents for whichever document the user is viewing.
  useEffect(() => {
    if (!detail) return;
    let filePath: string | null = null;
    let cacheKey: string | null = null;
    if (activeTabId === "notes") {
      filePath = `${runFolder}/notes.md`;
      cacheKey = "notes";
    } else if (activeTabId === "transcript") {
      filePath = `${runFolder}/transcript.md`;
      cacheKey = "transcript";
    } else if (activeTabId === "prompts" && activePromptId) {
      const p = promptOutputs.find((x) => x.id === activePromptId);
      if (p) {
        filePath = p.filePath;
        cacheKey = `prompt:${p.id}`;
      }
    }
    if (!filePath || !cacheKey) return;
    if (tabContents[cacheKey] != null) return;
    const key = cacheKey;
    const path = filePath;
    api.runs
      .readFile(path)
      .then((content) => setTabContents((prev) => ({ ...prev, [key]: content })))
      .catch(() =>
        setTabContents((prev) => ({ ...prev, [key]: "_(file not found)_" }))
      );
  }, [activeTabId, activePromptId, detail, promptOutputs, runFolder, tabContents]);

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

  const notesContent = tabContents.notes ?? "";
  const transcriptContent = tabContents.transcript ?? "";
  const activePrompt = activePromptId
    ? promptOutputs.find((p) => p.id === activePromptId) ?? null
    : null;
  const promptContent = activePromptId
    ? tabContents[`prompt:${activePromptId}`] ?? ""
    : "";

  const obsidianTargetPath =
    activeTabId === "notes"
      ? `${runFolder}/notes.md`
      : activeTabId === "transcript"
      ? `${runFolder}/transcript.md`
      : activeTabId === "prompts" && activePrompt
      ? activePrompt.filePath
      : null;

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
        <>
          {config.llm_provider === "ollama" &&
            sections.some((s) => s.state === "running") && (
              <div
                className="card"
                style={{ borderColor: "var(--accent, #6aa0ff)", marginBottom: 8 }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="spinner" aria-hidden="true" />
                  <strong>Processing locally with {config.ollama.model}</strong>
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  Stay in the app — local models are slower per section than
                  cloud LLMs but never leave your machine.
                </div>
              </div>
            )}
          <PipelineStatus sections={sections} title="Live processing" />
        </>
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

      {activeTabId === "overview" && (
        <OverviewPanel detail={detail} runFolder={runFolder} onUpdated={refresh} />
      )}

      {activeTabId === "notes" && (
        <div style={{ height: "60vh" }}>
          <MarkdownEditor
            value={notesContent}
            onChange={onNotesChange}
            onBlur={onNotesBlur}
          />
        </div>
      )}

      {activeTabId === "transcript" && <MarkdownView source={transcriptContent} />}

      {activeTabId === "prompts" && (
        <div className="prompts-tab">
          <aside className="prompts-tab-nav">
            <div className="prompts-tab-nav-header">
              <button onClick={() => setRunPromptOpen(true)}>Run prompt…</button>
            </div>
            {promptOutputs.length === 0 ? (
              <div className="muted" style={{ padding: 12 }}>
                No prompt outputs yet.
              </div>
            ) : (
              promptOutputs.map((p) => (
                <button
                  key={p.id}
                  className={`prompts-tab-nav-item ${
                    activePromptId === p.id ? "active" : ""
                  }`}
                  onClick={() => setActivePromptId(p.id)}
                >
                  <span className={`status-pill ${p.status ?? "pending"}`}>
                    {p.status ?? "—"}
                  </span>
                  <span className="prompts-tab-nav-label">{p.label}</span>
                </button>
              ))
            )}
          </aside>
          <div className="prompts-tab-content">
            {activePrompt ? (
              <MarkdownView source={promptContent} />
            ) : (
              <div className="muted">Select a prompt to view its output.</div>
            )}
          </div>
        </div>
      )}

      {config.obsidian_integration.enabled && obsidianTargetPath && (
        <div style={{ marginTop: 12 }}>
          <button
            onClick={() =>
              api.runs.openInObsidian(obsidianTargetPath).catch(() => {})
            }
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
