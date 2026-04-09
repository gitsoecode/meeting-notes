import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../ipc-client";
import type {
  AppConfigDTO,
  RecordingStatus,
  PipelineProgressEvent,
  RunSummary,
} from "../../../shared/ipc";
import { MarkdownEditor } from "../components/MarkdownEditor";
import {
  PipelineStatus,
  applyProgress,
  type SectionStatus,
} from "../components/PipelineStatus";
import { AudioMeter } from "../components/AudioMeter";
import { relativeDateLabel } from "../constants";

interface RecordViewProps {
  recording: RecordingStatus;
  config: AppConfigDTO;
  onMeetingStopped?: (runFolder: string) => void;
  onOpenMeeting?: (runFolder: string) => void;
}

export function RecordView({
  recording,
  config: _config,
  onMeetingStopped,
  onOpenMeeting,
}: RecordViewProps) {
  const [title, setTitle] = useState("Untitled Meeting");
  const [description, setDescription] = useState("");
  const [recentRuns, setRecentRuns] = useState<RunSummary[]>([]);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [notes, setNotes] = useState("");
  const [notesPath, setNotesPath] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);

  const [sections, setSections] = useState<SectionStatus[]>([]);
  const [elapsedSec, setElapsedSec] = useState(0);

  // Load notes.md when an active recording exists.
  useEffect(() => {
    let cancelled = false;
    const folder = recording.run_folder;
    if (!recording.active || !folder) {
      setNotes("");
      setNotesPath(null);
      return;
    }
    const p = `${folder}/notes.md`;
    setNotesPath(p);
    api.runs
      .readFile(p)
      .then((content) => {
        if (!cancelled) setNotes(content);
      })
      .catch((err) => console.warn("failed to read notes.md", err));
    return () => {
      cancelled = true;
    };
  }, [recording.active, recording.run_folder]);

  // Tick an elapsed timer from started_at.
  useEffect(() => {
    if (!recording.active || !recording.started_at) {
      setElapsedSec(0);
      return;
    }
    const start = new Date(recording.started_at).getTime();
    const update = () => setElapsedSec(Math.floor((Date.now() - start) / 1000));
    update();
    const id = window.setInterval(update, 1000);
    return () => clearInterval(id);
  }, [recording.active, recording.started_at]);

  // Subscribe to pipeline progress for live section status.
  useEffect(() => {
    const unsub = api.on.pipelineProgress((event: PipelineProgressEvent) => {
      // Only track events for the current run.
      if (recording.run_folder && event.runFolder !== recording.run_folder) {
        return;
      }
      setSections((prev) => applyProgress(prev, event));
    });
    return () => unsub();
  }, [recording.run_folder]);

  // Reset sections when a new recording starts.
  useEffect(() => {
    if (recording.active) setSections([]);
  }, [recording.run_folder]);

  // Load recent meetings to show on Home when not recording.
  useEffect(() => {
    if (recording.active) return;
    let cancelled = false;
    api.runs
      .list()
      .then((list) => {
        if (cancelled) return;
        const sorted = [...list].sort(
          (a, b) =>
            (Date.parse(b.started || b.date) || 0) -
            (Date.parse(a.started || a.date) || 0)
        );
        setRecentRuns(sorted.slice(0, 6));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [recording.active]);

  const onStart = async () => {
    setError(null);
    setStarting(true);
    try {
      await api.recording.start({
        title: title.trim() || "Untitled Meeting",
        description: description.trim() || null,
      });
      setDescription("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const onStop = async () => {
    setError(null);
    setStopping(true);
    try {
      // Flush notes.md before the pipeline reads it.
      if (notesPath) {
        await api.runs.writeFile(notesPath, notes).catch(() => {});
      }
      const result = await api.recording.stop();
      if (result?.run_folder && onMeetingStopped) {
        onMeetingStopped(result.run_folder);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStopping(false);
    }
  };

  const onNotesChange = (value: string) => {
    setNotes(value);
    if (!notesPath) return;
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      api.runs.writeFile(notesPath, value).catch((err) => {
        console.warn("notes write failed", err);
      });
    }, 400);
  };

  const onNotesBlur = () => {
    if (!notesPath) return;
    api.runs.writeFile(notesPath, notes).catch(() => {});
  };

  const elapsedLabel = useMemo(() => {
    const h = Math.floor(elapsedSec / 3600);
    const m = Math.floor((elapsedSec % 3600) / 60);
    const s = elapsedSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }, [elapsedSec]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="section-title">Home</h1>
          <p className="section-subtitle">
            {recording.active
              ? `Recording "${recording.title ?? "Untitled Meeting"}"`
              : "Start a new meeting or jump back into a recent one."}
          </p>
        </div>
      </div>

      {!recording.active && (
        <>
          <div className="card start-meeting-card">
            <label htmlFor="title">Meeting title</label>
            <input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Untitled Meeting"
            />
            <label htmlFor="description" style={{ marginTop: 12 }}>
              Description (optional)
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What's this meeting about?"
            />
            <div style={{ marginTop: 16 }}>
              <button className="primary big" onClick={onStart} disabled={starting}>
                {starting ? "Starting…" : "Start recording"}
              </button>
            </div>
            {error && <div className="muted tone-error" style={{ marginTop: 12 }}>{error}</div>}
          </div>

          {recentRuns.length > 0 && (
            <div style={{ marginTop: 28 }}>
              <h2 className="section-title" style={{ fontSize: 18, marginBottom: 12 }}>
                Recent meetings
              </h2>
              <div className="recent-meetings-grid">
                {recentRuns.map((r) => (
                  <button
                    key={r.folder_path}
                    type="button"
                    className="recent-meeting-card"
                    onClick={() => onOpenMeeting?.(r.folder_path)}
                  >
                    <div className="recent-meeting-title">{r.title}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {relativeDateLabel(r.started || r.date)}
                      {r.duration_minutes != null
                        ? ` · ${r.duration_minutes.toFixed(1)}m`
                        : ""}
                    </div>
                    {r.description && (
                      <div className="recent-meeting-desc">
                        {r.description.split("\n")[0]}
                      </div>
                    )}
                    <div style={{ marginTop: 8 }}>
                      <span className={`status-pill ${r.status}`}>{r.status}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {recording.active && (
        <div className="record-layout">
          <div className="record-editor-pane">
            <MarkdownEditor
              value={notes}
              onChange={onNotesChange}
              onBlur={onNotesBlur}
              placeholder="- type notes here"
            />
          </div>
          <div className="record-controls">
            <div className="card">
              <div className={`status-big recording`}>
                <span className="dot" /> Recording · {elapsedLabel}
              </div>
              <div className="muted" style={{ marginTop: 6 }}>
                {recording.title ?? "Untitled Meeting"}
              </div>
              <div className="muted" style={{ marginTop: 6 }}>
                System audio: {recording.system_captured ? "captured" : "mic only"}
              </div>
              <div style={{ marginTop: 14 }}>
                <AudioMeter active={recording.active} />
              </div>
              <div style={{ marginTop: 16 }}>
                <button className="danger big" onClick={onStop} disabled={stopping}>
                  {stopping ? "Stopping…" : "Stop"}
                </button>
              </div>
              {error && <div className="muted tone-error" style={{ marginTop: 12 }}>{error}</div>}
            </div>
            <PipelineStatus sections={sections} title="Processing" />
          </div>
        </div>
      )}
    </>
  );
}
