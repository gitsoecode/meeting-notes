import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../ipc-client";
import type {
  AppConfigDTO,
  RecordingStatus,
  PipelineProgressEvent,
} from "../../../shared/ipc";
import { MarkdownEditor } from "../components/MarkdownEditor";
import {
  PipelineStatus,
  applyProgress,
  type SectionStatus,
} from "../components/PipelineStatus";
import { AudioMeter } from "../components/AudioMeter";

interface RecordViewProps {
  recording: RecordingStatus;
  config: AppConfigDTO;
}

export function RecordView({ recording, config: _config }: RecordViewProps) {
  const [title, setTitle] = useState("Untitled Meeting");
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

  const onStart = async () => {
    setError(null);
    setStarting(true);
    try {
      await api.recording.start({ title: title.trim() || "Untitled Meeting" });
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
      await api.recording.stop();
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
      <h1 className="section-title">Record</h1>
      <p className="section-subtitle">
        {recording.active
          ? `Recording "${recording.title ?? "Untitled Meeting"}"`
          : "Type a title, hit start, take notes while the call runs."}
      </p>

      {!recording.active && (
        <div className="card">
          <label htmlFor="title">Meeting title</label>
          <input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled Meeting"
          />
          <div style={{ marginTop: 16 }}>
            <button className="primary big" onClick={onStart} disabled={starting}>
              {starting ? "Starting…" : "Start recording"}
            </button>
          </div>
          {error && <div className="muted" style={{ color: "var(--danger)", marginTop: 12 }}>{error}</div>}
        </div>
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
              {error && (
                <div className="muted" style={{ color: "var(--danger)", marginTop: 12 }}>
                  {error}
                </div>
              )}
            </div>
            <PipelineStatus sections={sections} title="Processing" />
          </div>
        </div>
      )}
    </>
  );
}
