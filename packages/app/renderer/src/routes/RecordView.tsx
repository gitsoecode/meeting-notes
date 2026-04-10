import { useEffect, useMemo, useRef, useState } from "react";
import { CirclePlay, NotebookPen } from "lucide-react";
import { api } from "../ipc-client";
import type {
  AppConfigDTO,
  PipelineProgressEvent,
  PromptRow,
  RecordingStatus,
} from "../../../shared/ipc";
import { PRIMARY_PROMPT_ID } from "../../../shared/meeting-prompts";
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
import { Checkbox } from "../components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group";
import { Spinner } from "../components/ui/spinner";
import { Textarea } from "../components/ui/textarea";
import { getDefaultPromptModel, getPromptModelSummary } from "../lib/prompt-metadata";

interface RecordViewProps {
  recording: RecordingStatus;
  config: AppConfigDTO;
  onMeetingStopped?: (runFolder: string) => void;
  onOpenMeeting?: (runFolder: string) => void;
}

type EndMeetingMode = "process" | "save" | "delete";

interface ProcessStep {
  id: string;
  label: string;
  description: string | null;
  modelNote: string | null;
  promptId?: string;
}

const TRANSCRIPT_STEP_ID = "__transcript__";

function formatModelNote(prompt: Pick<PromptRow, "model"> | null | undefined, defaultModel: string | null) {
  const model = getPromptModelSummary(prompt, defaultModel);
  if (!model.id) return "Model unavailable";
  const displayLabel = model.rawId ?? model.label;
  if (model.providerLabel === "Local model") {
    return `Uses local model ${displayLabel}`;
  }
  return `Uses ${model.label}`;
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
  const [stopMode, setStopMode] = useState<EndMeetingMode | null>(null);
  const [endDialogOpen, setEndDialogOpen] = useState(false);
  const [endMode, setEndMode] = useState<EndMeetingMode>("process");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [selectedProcessStepIds, setSelectedProcessStepIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [sections, setSections] = useState<SectionStatus[]>([]);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
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
    let alive = true;
    void api.prompts.list()
      .then((list) => {
        if (alive) setPrompts(list);
      })
      .catch(() => {
        if (alive) setPrompts([]);
      });
    return () => {
      alive = false;
    };
  }, []);

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

  useEffect(() => {
    if (!recording.active) {
      setEndDialogOpen(false);
      setConfirmDeleteOpen(false);
      setEndMode("process");
      setSelectedProcessStepIds([]);
    }
  }, [recording.active]);

  const defaultModel = useMemo(() => getDefaultPromptModel(config), [config]);

  const processSteps = useMemo<ProcessStep[]>(() => {
    const summaryPrompt = prompts.find((prompt) => prompt.id === PRIMARY_PROMPT_ID) ?? null;
    const autoPrompts = prompts.filter(
      (prompt) => prompt.id !== PRIMARY_PROMPT_ID && prompt.enabled && prompt.auto
    );

    return [
      {
        id: TRANSCRIPT_STEP_ID,
        label: "Transcribe",
        description: "Create transcript.md from the captured recording before any summaries or prompts run.",
        modelNote: null,
      },
      {
        id: PRIMARY_PROMPT_ID,
        label: summaryPrompt?.label ?? "Summary",
        description:
          summaryPrompt?.description ??
          "Create the default meeting summary and action items after transcription completes.",
        modelNote: formatModelNote(summaryPrompt, defaultModel),
        promptId: PRIMARY_PROMPT_ID,
      },
      ...autoPrompts.map((prompt) => ({
        id: prompt.id,
        label: prompt.label,
        description: prompt.description,
        modelNote: formatModelNote(prompt, defaultModel),
        promptId: prompt.id,
      })),
    ];
  }, [defaultModel, prompts]);

  const resetEndMeetingState = () => {
    setEndMode("process");
    setSelectedProcessStepIds(processSteps.map((step) => step.id));
    setConfirmDeleteOpen(false);
    setError(null);
  };

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

  const flushNotes = async () => {
    if (!recording.run_folder) return;
    await api.runs.writeNotes(recording.run_folder, notes).catch(() => {});
  };

  const finalizeStop = async (mode: EndMeetingMode) => {
    await flushNotes();

    if (mode === "delete") {
      await api.recording.stop({ mode: "delete" });
      setNotes("");
      return;
    }

    const result = await api.recording.stop({ mode: "save" });
    if (!result?.run_folder) return;

    if (mode === "process") {
      const onlyIds = selectedProcessStepIds.filter((id) => id !== TRANSCRIPT_STEP_ID);
      await api.runs.startProcessRecording({ runFolder: result.run_folder, onlyIds });
    }

    if (onMeetingStopped) {
      onMeetingStopped(result.run_folder);
    }
  };

  const onConfirmEndMeeting = async () => {
    setError(null);

    if (endMode === "delete") {
      setEndDialogOpen(false);
      setConfirmDeleteOpen(true);
      return;
    }

    setStopMode(endMode);
    try {
      await finalizeStop(endMode);
      setEndDialogOpen(false);
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
      await finalizeStop("delete");
      setConfirmDeleteOpen(false);
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

  const selectedStepSet = useMemo(
    () => new Set(selectedProcessStepIds),
    [selectedProcessStepIds]
  );
  const transcriptSelected = selectedStepSet.has(TRANSCRIPT_STEP_ID);
  const processConfirmDisabled = endMode === "process" && !transcriptSelected;
  const stopping = stopMode !== null;
  const deleting = stopMode === "delete";

  const confirmLabel =
    endMode === "process"
      ? "End meeting"
      : endMode === "save"
        ? "Save meeting"
        : "Review delete";
  const confirmingLabel =
    stopMode === "process"
      ? "Saving and queueing…"
      : stopMode === "save"
        ? "Saving…"
        : "Deleting…";

  return (
    <PageScaffold
      className="gap-4 md:gap-5"
      onDragOver={(event) => {
        if (recording.active || importing) return;
        if (event.dataTransfer.files.length === 0) return;
        event.preventDefault();
      }}
      onDrop={(event) => {
        if (recording.active || importing) return;
        event.preventDefault();
        const file = event.dataTransfer.files?.[0];
        if (!file) return;
        void importDroppedFile(file);
      }}
    >
      {!recording.active ? (
        <>
          <PageIntro
            title="Start or import a meeting"
            compact
            description={
              <>
                Capture a live meeting, write notes while you talk, and keep the transcript
                and generated outputs as editable markdown on your machine.
              </>
            }
          />

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
                Keep writing notes while audio is being captured. Use End meeting when you are
                ready to process the transcript, save the recording for later, or discard this run.
              </>
            }
            actions={
              <Button
                variant="secondary"
                onClick={() => {
                  resetEndMeetingState();
                  setEndDialogOpen(true);
                }}
                disabled={stopping}
              >
                End meeting
              </Button>
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
                    <span>{config.llm_provider === "ollama" ? config.ollama.model : config.claude.model}</span>
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
                    End the meeting to choose whether to process now, save the recording for later,
                    or delete the in-progress workspace.
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

      <Dialog
        open={endDialogOpen}
        onOpenChange={(open) => {
          if (!open && !stopping) {
            setEndDialogOpen(false);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>End meeting</DialogTitle>
            <DialogDescription>
              Stop the live recording, then choose whether to process outputs now, save the
              meeting for later, or delete this in-progress workspace.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <RadioGroup className="gap-3">
              <RadioGroupItem
                id="end-meeting-process"
                name="end-meeting-mode"
                checked={endMode === "process"}
                onChange={() => setEndMode("process")}
                label="Process meeting"
                description="Stop recording and choose which transcript and output steps should run right away."
              />
              <RadioGroupItem
                id="end-meeting-save"
                name="end-meeting-mode"
                checked={endMode === "save"}
                onChange={() => setEndMode("save")}
                label="Save recording without processing"
                description="Keep the recording, notes, and workspace on disk without running transcript or prompt outputs."
              />
              <RadioGroupItem
                id="end-meeting-delete"
                name="end-meeting-mode"
                checked={endMode === "delete"}
                onChange={() => setEndMode("delete")}
                label="Delete meeting"
                description="Discard the captured media, notes, and workspace after one more confirmation."
              />
            </RadioGroup>

            {endMode === "process" ? (
              <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)]/50 p-4">
                <div className="space-y-1">
                  <div className="text-sm font-medium text-[var(--text-primary)]">Processing steps</div>
                  <div className="text-sm text-[var(--text-secondary)]">
                    Uncheck anything you do not want to run after the meeting ends.
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {processSteps.map((step) => {
                    const checked = selectedStepSet.has(step.id);
                    const disabled = step.id !== TRANSCRIPT_STEP_ID && !transcriptSelected;
                    return (
                      <label
                        key={step.id}
                        className="flex items-start gap-3 rounded-md border border-[var(--border-default)] bg-white px-3 py-3"
                      >
                        <Checkbox
                          checked={checked}
                          disabled={disabled}
                          onCheckedChange={(nextChecked) => {
                            const isChecked = nextChecked === true;
                            setSelectedProcessStepIds((prev) => {
                              if (step.id === TRANSCRIPT_STEP_ID) {
                                return isChecked ? [TRANSCRIPT_STEP_ID] : [];
                              }
                              if (!prev.includes(TRANSCRIPT_STEP_ID)) {
                                return prev;
                              }
                              if (isChecked) {
                                return prev.includes(step.id) ? prev : [...prev, step.id];
                              }
                              return prev.filter((id) => id !== step.id);
                            });
                          }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-[var(--text-primary)]">
                            {step.label}
                          </span>
                          {step.description ? (
                            <span className="mt-1 block text-sm leading-6 text-[var(--text-secondary)]">
                              {step.description}
                            </span>
                          ) : null}
                          {step.modelNote ? (
                            <span className="mt-1 block text-xs font-medium uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                              {step.modelNote}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                </div>

                {processConfirmDisabled ? (
                  <div className="mt-3 text-sm text-[var(--text-secondary)]">
                    Enable Transcribe to run summary or prompt outputs, or switch to Save recording without processing.
                  </div>
                ) : null}
              </div>
            ) : endMode === "save" ? (
              <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)]/50 px-4 py-3 text-sm text-[var(--text-secondary)]">
                The meeting workspace, notes, and captured media will be saved on disk. You can open
                it right away and run processing later.
              </div>
            ) : (
              <div className="rounded-lg border border-[var(--error)]/15 bg-[var(--error-muted)]/70 px-4 py-3 text-sm text-[var(--text-secondary)]">
                Deleting removes the captured audio, notes, and meeting workspace permanently. You
                will get one more confirmation before anything is discarded.
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => setEndDialogOpen(false)}
              disabled={stopping}
            >
              Keep recording
            </Button>
            <Button
              variant={endMode === "delete" ? "destructive" : "default"}
              onClick={() => void onConfirmEndMeeting()}
              disabled={stopping || processConfirmDisabled}
            >
              {stopping && stopMode === endMode ? (
                <>
                  <Spinner />
                  {confirmingLabel}
                </>
              ) : (
                confirmLabel
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={(open) => {
          if (!open && !deleting) {
            setConfirmDeleteOpen(false);
          }
        }}
        title="Delete meeting?"
        description="This will stop the recording and permanently delete the captured audio, notes, and meeting workspace for this run. Processing will not start."
        cancelLabel="Keep meeting"
        confirmLabel="Delete meeting"
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
