import { useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  CirclePlay,
  NotebookPen,
} from "lucide-react";
import { api } from "../ipc-client";
import type {
  AppConfigDTO,
  PipelineProgressEvent,
  RecordingStatus,
} from "../../../shared/ipc";
import { AudioMeter } from "../components/AudioMeter";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { PageIntro, PageScaffold } from "../components/PageScaffold";
import {
  PipelineStatus,
  applyProgress,
  type SectionStatus,
} from "../components/PipelineStatus";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Spinner } from "../components/ui/spinner";
import { Textarea } from "../components/ui/textarea";

interface RecordViewProps {
  recording: RecordingStatus;
  config: AppConfigDTO;
  onMeetingStopped?: (runFolder: string) => void;
  onOpenMeeting?: (runFolder: string) => void;
}

export function RecordView({
  recording,
  config,
  onMeetingStopped,
  onOpenMeeting,
}: RecordViewProps) {
  const [title, setTitle] = useState(() => {
    const d = new Date();
    return `Meeting — ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  });
  const [description, setDescription] = useState("");
  const [starting, setStarting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [stopMode, setStopMode] = useState<"process" | "delete" | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [sections, setSections] = useState<SectionStatus[]>([]);
  const [elapsedSec, setElapsedSec] = useState(0);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const folder = recording.run_folder;
    if (!recording.active || !folder) {
      setNotes("");
      return;
    }
    api.runs
      .readDocument(folder, "notes.md")
      .then((content) => {
        if (!cancelled) setNotes(content);
      })
      .catch((err) => console.warn("failed to read notes.md", err));
    return () => {
      cancelled = true;
    };
  }, [recording.active, recording.run_folder]);

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

  useEffect(() => {
    const unsub = api.on.pipelineProgress((event: PipelineProgressEvent) => {
      if (recording.run_folder && event.runFolder !== recording.run_folder) {
        return;
      }
      setSections((prev) => applyProgress(prev, event));
    });
    return () => unsub();
  }, [recording.run_folder]);

  useEffect(() => {
    if (recording.active) setSections([]);
  }, [recording.active, recording.run_folder]);

  const deriveMeetingTitle = (fileName: string) => {
    const baseName = fileName.split(/[\\/]/).pop() ?? fileName;
    return (
      baseName
        .replace(/\.[^.]+$/, "")
        .replace(/[_-]+/g, " ")
        .trim() || "Imported meeting"
    );
  };

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
    setStopMode("process");
    try {
      if (recording.run_folder) {
        await api.runs.writeNotes(recording.run_folder, notes).catch(() => {});
      }
      const result = await api.recording.stop({ mode: "process" });
      if (result?.run_folder && onMeetingStopped) {
        onMeetingStopped(result.run_folder);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStopMode(null);
    }
  };

  const onDelete = async () => {
    setError(null);
    setStopMode("delete");
    try {
      await api.recording.stop({ mode: "delete" });
      setConfirmDeleteOpen(false);
      setNotes("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStopMode(null);
    }
  };

  const onImportSelected = async () => {
    setError(null);
    setImporting(true);
    try {
      const picked = await api.config.pickMediaFile();
      if (!picked) return;
      const result = await api.runs.processMedia(
        picked.token,
        deriveMeetingTitle(picked.name)
      );
      if (onOpenMeeting) {
        onOpenMeeting(result.run_folder);
      } else {
        window.location.hash = `#/meeting/${encodeURIComponent(result.run_folder)}`;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const importDroppedFile = async (file: File) => {
    setError(null);
    setImporting(true);
    try {
      const result = await api.runs.processDroppedMedia(
        file,
        deriveMeetingTitle(file.name)
      );
      if (onOpenMeeting) {
        onOpenMeeting(result.run_folder);
      } else {
        window.location.hash = `#/meeting/${encodeURIComponent(result.run_folder)}`;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const onNotesChange = (value: string) => {
    setNotes(value);
    if (!recording.run_folder) return;
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      api.runs.writeNotes(recording.run_folder!, value).catch((err) => {
        console.warn("notes write failed", err);
      });
    }, 400);
  };

  const onNotesBlur = () => {
    if (!recording.run_folder) return;
    api.runs.writeNotes(recording.run_folder, notes).catch(() => {});
  };

  const elapsedLabel = useMemo(() => {
    const h = Math.floor(elapsedSec / 3600);
    const m = Math.floor((elapsedSec % 3600) / 60);
    const s = elapsedSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }, [elapsedSec]);

  const stopping = stopMode !== null;
  const processing = stopMode === "process";
  const deleting = stopMode === "delete";

  return (
    <PageScaffold
      className="gap-4 md:gap-5"
      onDragOver={(event) => {
        if (recording.active || importing) return;
        if (event.dataTransfer.files.length === 0) return;
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragActive(false);
        }
      }}
      onDrop={(event) => {
        if (recording.active || importing) return;
        event.preventDefault();
        setDragActive(false);
        const file = event.dataTransfer.files?.[0];
        if (!file) return;
        void importDroppedFile(file);
      }}
    >
      {!recording.active ? (
        <>

          <Card className="overflow-hidden p-5 md:p-6">
              <CardHeader className="mb-3">
                <div className="space-y-2">
                  <CardTitle className="text-xl">New recording</CardTitle>
                  <CardDescription>
                    Capture a live meeting, take notes while you talk, and keep everything as local markdown.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-[var(--text-secondary)]">Title</label>
                    <Input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      onFocus={(e) => e.target.select()}
                      placeholder="Untitled Meeting"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-[var(--text-secondary)]">Description</label>
                    <Textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={2}
                      placeholder="What's this meeting about?"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <Button size="lg" onClick={onStart} disabled={starting}>
                    {starting ? (
                      <>
                        <Spinner />
                        Starting…
                      </>
                    ) : (
                      <>
                        <CirclePlay className="h-4 w-4" />
                        Start recording
                      </>
                    )}
                  </Button>
                  <span className="text-sm text-[var(--text-tertiary)]">
                    or{" "}
                    <button
                      type="button"
                      className="underline hover:text-[var(--text-secondary)]"
                      onClick={onImportSelected}
                      disabled={importing}
                    >
                      {importing ? "importing…" : "import a recording"}
                    </button>
                  </span>
                </div>
              </CardContent>
          </Card>

          {error ? (
            <div className="rounded-lg border border-[var(--error)]/20 bg-[var(--error-muted)] px-4 py-3 text-sm text-[var(--error)]">
              {error}
            </div>
          ) : null}
        </>
      ) : (
        <>
          <PageIntro
            badge="Recording live"
            title={recording.title ?? "Untitled Meeting"}
            description={
              <>
                Keep writing notes while audio is being captured. End and process to generate
                the transcript and prompt outputs, or end and delete to discard this in-progress
                meeting.
              </>
            }
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={onStop} disabled={stopping}>
                  {processing ? (
                    <>
                      <Spinner />
                      Ending…
                    </>
                  ) : (
                    "End and process"
                  )}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setConfirmDeleteOpen(true)}
                  disabled={stopping}
                >
                  End and delete
                </Button>
              </div>
            }
          />

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_360px]">
            <Card className="overflow-hidden p-6">
              <CardHeader className="mb-6">
                <div className="space-y-2">
                  <Badge variant="warning" className="w-fit">
                    Recording live
                  </Badge>
                  <CardTitle className="text-2xl">{recording.title ?? "Untitled Meeting"}</CardTitle>
                  <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--text-secondary)]">
                    <span>{elapsedLabel} elapsed</span>
                    <span>•</span>
                    <span>{config.asr_provider}</span>
                    <span>•</span>
                    <span>{
                      config.llm_provider === "ollama"
                        ? config.ollama.model
                        : config.llm_provider === "openai"
                        ? config.openai.model
                        : config.claude.model
                    }</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                    <NotebookPen className="h-4 w-4 text-[var(--accent)]" />
                    Live notes
                  </div>
                  <div className="h-[55vh] overflow-hidden rounded-md border border-[var(--border-default)] bg-white">
                    <MarkdownEditor
                      value={notes}
                      onChange={onNotesChange}
                      onBlur={onNotesBlur}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-5">
              <Card className="p-4 md:p-6">
                <CardHeader className="mb-4">
                  <div className="space-y-2">
                    <Badge variant="accent" className="w-fit">
                      Input levels
                    </Badge>
                    <CardTitle className="text-lg">Capture health</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <AudioMeter label="Microphone" active={recording.active} />
                  {recording.system_captured ? (
                    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--text-secondary)]">
                      <div className="font-medium text-[var(--text-primary)]">System audio</div>
                      <div className="mt-1">
                        Capturing system audio for this run. Live level metering is only shown
                        for the microphone input.
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--text-secondary)]">
                      System audio is not available for this run.
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="p-4 md:p-6">
                <CardHeader className="mb-4">
                  <div className="space-y-2">
                    <Badge variant="info" className="w-fit">
                      Pipeline
                    </Badge>
                    <CardTitle className="text-lg">What happens next</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4 text-sm text-[var(--text-secondary)]">
                    Transcript extraction and prompt runs start automatically after you end and
                    process. Local models may take a minute or two per section.
                  </div>
                  {sections.length > 0 && <PipelineStatus sections={sections} title="Live processing" />}
                </CardContent>
                <CardFooter className="border-t-0 pt-0">
                  <div className="text-sm text-[var(--text-secondary)]">
                    If the window is closed, the tray icon can reopen this workspace.
                  </div>
                </CardFooter>
              </Card>
            </div>
          </div>
          {error ? (
            <div className="rounded-lg border border-[var(--error)]/20 bg-[var(--error-muted)] px-4 py-3 text-sm text-[var(--error)]">
              {error}
            </div>
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={(open) => {
          if (!open && !deleting) {
            setConfirmDeleteOpen(false);
          }
        }}
        title="End and delete recording?"
        description="This will stop the recording and permanently delete the captured audio, notes, and meeting workspace for this in-progress run. Processing will not start."
        cancelLabel="Keep recording"
        confirmLabel="End and delete"
        confirmingLabel="Deleting…"
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={() => void onDelete()}
        disabled={deleting}
      >
        {recording.title ? (
          <div className="break-all rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--text-primary)]">
            {recording.title}
          </div>
        ) : null}
      </ConfirmDialog>
    </PageScaffold>
  );
}
