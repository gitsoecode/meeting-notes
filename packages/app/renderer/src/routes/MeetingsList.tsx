import { useEffect, useState } from "react";
import { api } from "../ipc-client";
import type { RunSummary, PromptRow } from "../../../shared/ipc";

interface MeetingsListProps {
  onOpen: (runFolder: string) => void;
}

export function MeetingsList({ onOpen }: MeetingsListProps) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await api.runs.list();
      setRuns(list);
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

  const toggleSelected = (folder: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  };

  const onImport = async () => {
    setImporting(true);
    try {
      const filePath = await api.config.pickAudioFile();
      if (!filePath) return;
      const title =
        window.prompt("Meeting title for this recording?", "Imported audio") ?? "Imported audio";
      await api.runs.processAudio(filePath, title);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 className="section-title">Meetings</h1>
          <p className="section-subtitle">
            {runs.length === 0
              ? "No meetings yet."
              : `${runs.length} meeting${runs.length === 1 ? "" : "s"} on disk.`}
          </p>
        </div>
        <div className="row">
          <button onClick={refresh} disabled={loading}>
            Refresh
          </button>
          <button onClick={onImport} disabled={importing}>
            {importing ? "Importing…" : "Import audio…"}
          </button>
          {selected.size > 0 && (
            <button className="primary" onClick={() => setBulkOpen(true)}>
              Run prompt on {selected.size} selected…
            </button>
          )}
        </div>
      </div>

      {error && <div className="muted" style={{ color: "var(--danger)" }}>{error}</div>}

      {loading ? (
        <div className="muted">Loading…</div>
      ) : runs.length === 0 ? (
        <div className="card muted">
          Start a recording or import an audio file to see it here.
        </div>
      ) : (
        <table className="meetings-table">
          <thead>
            <tr>
              <th style={{ width: 32 }}></th>
              <th>Title</th>
              <th>Date</th>
              <th>Duration</th>
              <th>Status</th>
              <th>Tags</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.folder_path}>
                <td onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected.has(r.folder_path)}
                    onChange={() => toggleSelected(r.folder_path)}
                    style={{ width: "auto" }}
                  />
                </td>
                <td onClick={() => onOpen(r.folder_path)}>{r.title}</td>
                <td onClick={() => onOpen(r.folder_path)}>
                  {new Date(r.started || r.date).toLocaleString()}
                </td>
                <td onClick={() => onOpen(r.folder_path)}>
                  {r.duration_minutes != null ? `${r.duration_minutes.toFixed(1)}m` : "—"}
                </td>
                <td onClick={() => onOpen(r.folder_path)}>
                  <span className={`status-pill ${r.status}`}>{r.status}</span>
                </td>
                <td onClick={() => onOpen(r.folder_path)}>{(r.tags ?? []).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {bulkOpen && (
        <BulkRunPromptModal
          runFolders={Array.from(selected)}
          onClose={() => setBulkOpen(false)}
          onDone={() => {
            setBulkOpen(false);
            setSelected(new Set());
            refresh();
          }}
        />
      )}
    </>
  );
}

interface BulkRunPromptModalProps {
  runFolders: string[];
  onClose: () => void;
  onDone: () => void;
}

function BulkRunPromptModal({ runFolders, onClose, onDone }: BulkRunPromptModalProps) {
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.prompts.list().then((list) => {
      setPrompts(list);
      if (list.length > 0) setSelectedPromptId(list[0].id);
    });
  }, []);

  const onRun = async () => {
    if (!selectedPromptId) return;
    setRunning(true);
    try {
      await api.runs.bulkReprocess({
        runFolders,
        onlyIds: [selectedPromptId],
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
        <h2>Run prompt on {runFolders.length} meetings</h2>
        <label>Prompt</label>
        <select
          value={selectedPromptId}
          onChange={(e) => setSelectedPromptId(e.target.value)}
        >
          {prompts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} {p.builtin ? "(builtin)" : ""}
            </option>
          ))}
        </select>
        {error && (
          <div className="muted" style={{ color: "var(--danger)", marginTop: 12 }}>{error}</div>
        )}
        <div className="actions">
          <button onClick={onClose} disabled={running}>
            Cancel
          </button>
          <button className="primary" onClick={onRun} disabled={running || !selectedPromptId}>
            {running ? "Running…" : "Run"}
          </button>
        </div>
      </div>
    </div>
  );
}
