import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CirclePlay,
  FileUp,
  NotebookPen,
  Pause,
  Play,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../ipc-client";
import type {
  AppConfigDTO,
  PipelineProgressEvent,
  PromptRow,
  RecordingStatus,
  RunSummary,
} from "../../../shared/ipc";
import { PRIMARY_PROMPT_ID } from "../../../shared/meeting-prompts";
import { LiveChannelMeters } from "../components/LiveChannelMeters";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DateTimePicker } from "../components/DateTimePicker";
import { DisclosurePanel } from "../components/DisclosurePanel";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { MarkdownView } from "../components/MarkdownView";
import { MeetingHeader } from "../components/MeetingHeader";
import { PageScaffold } from "../components/PageScaffold";
import {
  PipelineStatus,
  applyProgress,
  type PromptOutputStatus,
} from "../components/PipelineStatus";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import { getDefaultPromptModel, getPromptModelSummary } from "../lib/prompt-metadata";
import { relativeDateLabel } from "../constants";

interface RecordViewProps {
  recording: RecordingStatus;
  config: AppConfigDTO;
  /** When set, display the draft/prep view for this run folder. */
  draftRunFolder?: string;
  onMeetingStopped?: (runFolder: string) => void;
  onOpenMeeting?: (runFolder: string) => void;
  onOpenPrep?: (runFolder: string) => void;
  onViewAllMeetings?: () => void;
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
  draftRunFolder,
  onMeetingStopped,
  onOpenMeeting,
  onOpenPrep,
  onViewAllMeetings,
}: RecordViewProps) {
  // ---- Home page state ----
  const [title, setTitle] = useState(() => {
    const d = new Date();
    return `Meeting - ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  });
  const [description, setDescription] = useState("");
  const [scheduledTime, setScheduledTime] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- Draft state ----
  const [draftTab, setDraftTab] = useState<"prep" | "notes" | "analysis" | "files">("prep");
  const [prepNotes, setPrepNotes] = useState("");
  const [prepEditable, setPrepEditable] = useState(true);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftScheduledTime, setDraftScheduledTime] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Array<{ name: string; size: number }>>([]);

  // ---- Recording / shared state ----
  const [notes, setNotes] = useState("");
  const [stopMode, setStopMode] = useState<EndMeetingMode | null>(null);
  const [endDialogOpen, setEndDialogOpen] = useState(false);
  const [endMode, setEndMode] = useState<EndMeetingMode>("process");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [selectedProcessStepIds, setSelectedProcessStepIds] = useState<string[]>([]);
  const [sections, setSections] = useState<PromptOutputStatus[]>([]);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const saveTimer = useRef<number | null>(null);
  const prepSaveTimer = useRef<number | null>(null);

  // ---- Timeline state ----
  const [recentRuns, setRecentRuns] = useState<RunSummary[]>([]);

  const activeRunFolder = draftRunFolder ?? recording.run_folder;
  const isDraft = !!draftRunFolder && !recording.active;
  const isRecording = recording.active && !recording.paused;
  const isPaused = recording.active && !!recording.paused;
  const isHome = !draftRunFolder && !recording.active;

  // ---- Load runs for timeline ----
  useEffect(() => {
    if (!isHome) return;
    api.runs.list().then(setRecentRuns).catch(() => setRecentRuns([]));
  }, [isHome]);

  // ---- Load draft data ----
  useEffect(() => {
    if (!draftRunFolder) return;
    let cancelled = false;
    void (async () => {
      try {
        const detail = await api.runs.get(draftRunFolder);
        if (cancelled) return;
        setDraftTitle(detail.title);
        setDraftDescription(detail.description ?? "");
        setDraftScheduledTime(detail.scheduled_time ?? null);
        const prep = await api.runs.readPrep(draftRunFolder);
        if (!cancelled) setPrepNotes(prep);
        const n = await api.runs.readDocument(draftRunFolder, "notes.md").catch(() => "");
        if (!cancelled) setNotes(n);
        const att = await api.runs.listAttachments(draftRunFolder);
        if (!cancelled) setAttachments(att);
      } catch (err) {
        console.warn("Failed to load draft", err);
      }
    })();
    return () => { cancelled = true; };
  }, [draftRunFolder]);

  // ---- Load notes for active recording ----
  useEffect(() => {
    if (!recording.active || !recording.run_folder) { setNotes(""); return; }
    let cancelled = false;
    api.runs.readDocument(recording.run_folder, "notes.md")
      .then((c) => { if (!cancelled) setNotes(c); })
      .catch(() => {});
    // Also load prep notes
    api.runs.readPrep(recording.run_folder)
      .then((c) => { if (!cancelled) { setPrepNotes(c); setPrepEditable(false); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [recording.active, recording.run_folder]);

  useEffect(() => {
    let alive = true;
    void api.prompts.list()
      .then((list) => { if (alive) setPrompts(list); })
      .catch(() => { if (alive) setPrompts([]); });
    return () => { alive = false; };
  }, []);

  // ---- Elapsed timer ----
  useEffect(() => {
    if ((!recording.active || recording.paused) || !recording.started_at) { setElapsedSec(0); return; }
    const start = new Date(recording.started_at).getTime();
    const update = () => setElapsedSec(Math.floor((Date.now() - start) / 1000));
    update();
    const id = window.setInterval(update, 1000);
    return () => clearInterval(id);
  }, [recording.active, recording.paused, recording.started_at]);

  // ---- Pipeline progress ----
  useEffect(() => {
    const unsub = api.on.pipelineProgress((event: PipelineProgressEvent) => {
      if (recording.run_folder && event.runFolder !== recording.run_folder) return;
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
    const summaryPrompt = prompts.find((p) => p.id === PRIMARY_PROMPT_ID) ?? null;
    const autoPrompts = prompts.filter((p) => p.id !== PRIMARY_PROMPT_ID && p.enabled && p.auto);
    return [
      { id: TRANSCRIPT_STEP_ID, label: "Transcribe", description: "Create transcript from the recording.", modelNote: null },
      { id: PRIMARY_PROMPT_ID, label: summaryPrompt?.label ?? "Summary", description: summaryPrompt?.description ?? "Generate meeting summary.", modelNote: formatModelNote(summaryPrompt, defaultModel), promptId: PRIMARY_PROMPT_ID },
      ...autoPrompts.map((p) => ({ id: p.id, label: p.label, description: p.description, modelNote: formatModelNote(p, defaultModel), promptId: p.id })),
    ];
  }, [defaultModel, prompts]);

  const resetEndMeetingState = () => {
    setEndMode("process");
    setSelectedProcessStepIds(processSteps.map((s) => s.id));
    setConfirmDeleteOpen(false);
    setError(null);
  };

  // ---- Actions ----
  const onStart = async () => {
    setError(null);
    setStarting(true);
    try {
      if (draftRunFolder) {
        await api.recording.startForDraft({ runFolder: draftRunFolder });
      } else {
        await api.recording.start({ title: title.trim() || "Untitled Meeting", description: description.trim() || null });
        setDescription("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const onCreateDraft = async () => {
    setError(null);
    try {
      const result = await api.runs.createDraft({
        title: title.trim() || "Untitled Meeting",
        description: description.trim() || null,
        scheduledTime,
      });
      onOpenPrep?.(result.run_folder);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onPause = async () => {
    try { await api.recording.pause(); } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onResume = async () => {
    try { await api.recording.resume(); } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const flushNotes = async () => {
    const folder = activeRunFolder;
    if (!folder) return;
    await api.runs.writeNotes(folder, notes).catch(() => {});
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
    onMeetingStopped?.(result.run_folder);
  };

  const onConfirmEndMeeting = async () => {
    setError(null);
    if (endMode === "delete") { setEndDialogOpen(false); setConfirmDeleteOpen(true); return; }
    setStopMode(endMode);
    try { await finalizeStop(endMode); setEndDialogOpen(false); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setStopMode(null); }
  };

  const onDelete = async () => {
    setError(null);
    setStopMode("delete");
    try {
      if (isDraft && draftRunFolder) {
        await api.runs.deleteRun(draftRunFolder);
        onOpenMeeting?.(""); // navigate away
      } else {
        await finalizeStop("delete");
      }
      setConfirmDeleteOpen(false);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setStopMode(null); }
  };

  const onImportSelected = async () => {
    setError(null);
    setImporting(true);
    try {
      const picked = await api.config.pickMediaFile();
      if (!picked) return;
      const baseName = picked.name.split(/[\\/]/).pop() ?? picked.name;
      const meetingTitle = baseName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Imported meeting";
      const result = await api.runs.processMedia(picked.token, meetingTitle);
      onOpenMeeting?.(result.run_folder);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setImporting(false); }
  };

  // ---- Auto-save helpers ----
  const onNotesChange = (value: string) => {
    setNotes(value);
    const folder = activeRunFolder;
    if (!folder) return;
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      api.runs.writeNotes(folder, value).catch(() => {});
    }, 400);
  };

  const onPrepChange = (value: string) => {
    setPrepNotes(value);
    const folder = activeRunFolder;
    if (!folder) return;
    if (prepSaveTimer.current != null) window.clearTimeout(prepSaveTimer.current);
    prepSaveTimer.current = window.setTimeout(() => {
      api.runs.writePrep(folder, value).catch(() => {});
    }, 400);
  };

  const onTitleSave = (newTitle: string) => {
    const folder = activeRunFolder;
    if (!folder || !newTitle.trim()) return;
    setDraftTitle(newTitle);
    api.runs.updateMeta({ runFolder: folder, title: newTitle.trim() }).catch(() => {});
  };

  const onDescriptionSave = (value: string) => {
    const folder = activeRunFolder;
    if (!folder) return;
    setDraftDescription(value);
    api.runs.updateMeta({ runFolder: folder, description: value.trim() || null }).catch(() => {});
  };

  const onAddAttachment = async () => {
    const folder = activeRunFolder;
    if (!folder) return;
    const result = await api.runs.addAttachment(folder);
    if (result) setAttachments((prev) => [...prev, { name: result.fileName, size: result.size }]);
  };

  const onRemoveAttachment = async (name: string) => {
    const folder = activeRunFolder;
    if (!folder) return;
    await api.runs.removeAttachment(folder, name);
    setAttachments((prev) => prev.filter((a) => a.name !== name));
  };

  const onScheduledTimeChange = (iso: string | null) => {
    if (draftRunFolder) {
      setDraftScheduledTime(iso);
      api.runs.updatePrep({ runFolder: draftRunFolder, scheduledTime: iso }).catch(() => {});
    } else {
      setScheduledTime(iso);
    }
  };

  const elapsedLabel = useMemo(() => {
    const h = Math.floor(elapsedSec / 3600);
    const m = Math.floor((elapsedSec % 3600) / 60);
    const s = elapsedSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }, [elapsedSec]);

  const selectedStepSet = useMemo(() => new Set(selectedProcessStepIds), [selectedProcessStepIds]);
  const transcriptSelected = selectedStepSet.has(TRANSCRIPT_STEP_ID);
  const processConfirmDisabled = endMode === "process" && !transcriptSelected;
  const stopping = stopMode !== null;

  // ---- Timeline data ----
  const { upcoming, recent } = useMemo(() => {
    const now = new Date();
    const drafts = recentRuns.filter((r) => r.status === "draft");
    // Upcoming: drafts with a scheduled time in the future, sorted soonest-first
    const upcomingDrafts = drafts
      .filter((r) => r.scheduled_time && new Date(r.scheduled_time) >= now)
      .sort((a, b) => new Date(a.scheduled_time!).getTime() - new Date(b.scheduled_time!).getTime());
    // Also include drafts without a scheduled time (unscheduled prep)
    const unscheduledDrafts = drafts.filter((r) => !r.scheduled_time);
    const up = [...upcomingDrafts, ...unscheduledDrafts];
    // Recent: non-draft meetings, most recent first, limited to 5
    const rec = recentRuns.filter((r) => r.status !== "draft").slice(0, 3);
    return { upcoming: up, recent: rec };
  }, [recentRuns]);

  // ---- Render: HOME (no recording, no draft) ----
  if (isHome) {
    return (
      <PageScaffold
        className="gap-4 md:gap-5"
        onDragOver={(e) => { if (!importing) { e.preventDefault(); } }}
        onDrop={(e) => {
          if (importing) return;
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file) {
            setImporting(true);
            const baseName = file.name.split(/[\\/]/).pop() ?? file.name;
            const meetingTitle = baseName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Imported meeting";
            api.runs.processDroppedMedia(file, meetingTitle)
              .then((r) => onOpenMeeting?.(r.run_folder))
              .catch((err) => setError(err instanceof Error ? err.message : String(err)))
              .finally(() => setImporting(false));
          }
        }}
      >
        {/* New Meeting card */}
        <Card className="shrink-0 overflow-hidden p-5 md:p-6">
          <CardHeader className="mb-3">
            <CardTitle className="text-xl">New meeting</CardTitle>
            <CardDescription>
              Start recording now or prepare a meeting workspace for later.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
            <DateTimePicker
              value={scheduledTime}
              onChange={setScheduledTime}
              dateLabel="Scheduled date"
              timeLabel="Time"
            />
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button size="lg" onClick={onStart} disabled={starting}>
                {starting ? <><Spinner /> Starting…</> : <><CirclePlay className="h-4 w-4" /> Start recording</>}
              </Button>
              <Button size="lg" variant="secondary" onClick={onCreateDraft}>
                <NotebookPen className="h-4 w-4" /> Prepare for later
              </Button>
              <span className="text-sm text-[var(--text-tertiary)]">
                or{" "}
                <button type="button" className="underline hover:text-[var(--text-secondary)]" onClick={onImportSelected} disabled={importing}>
                  {importing ? "importing…" : "import a recording"}
                </button>
              </span>
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="rounded-lg border border-[var(--error)]/20 bg-[var(--error-muted)] px-4 py-3 text-sm text-[var(--error)]">
            {error}
          </div>
        )}

        {/* Coming Up + Recent timeline */}
        <Card className="shrink-0 overflow-hidden p-5 md:p-6">
          {/* Upcoming section */}
          <CardHeader className="mb-4">
            <CardTitle className="text-lg">Coming up</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {upcoming.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-[var(--text-tertiary)]">
                No upcoming meetings. Create a draft to prepare for your next one.
              </div>
            ) : (
              <div className="divide-y divide-dashed divide-[var(--border-default)]">
                {upcoming.map((run) => {
                  const d = run.scheduled_time ? new Date(run.scheduled_time) : new Date(run.started);
                  const dayNum = d.getDate();
                  const monthLabel = d.toLocaleDateString("en-US", { month: "long" });
                  const dayOfWeek = d.toLocaleDateString("en-US", { weekday: "short" });
                  const isToday = new Date().toDateString() === d.toDateString();
                  const timeLabel = run.scheduled_time
                    ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
                    : "Not scheduled";

                  return (
                    <button
                      key={run.run_id}
                      type="button"
                      className="flex w-full items-start gap-6 px-4 py-4 text-left transition-colors hover:bg-[var(--bg-secondary)]/50"
                      onClick={() => onOpenPrep?.(run.folder_path)}
                    >
                      <div className="w-16 shrink-0 text-center">
                        <div className="flex items-baseline justify-center gap-1">
                          <span className="text-3xl font-light text-[var(--text-primary)]">{dayNum}</span>
                          <div className="text-xs text-[var(--text-secondary)]">
                            <div>{monthLabel}</div>
                            <div>{dayOfWeek}</div>
                          </div>
                          {isToday && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-red-500" />}
                        </div>
                      </div>
                      <div className="min-w-0 flex-1 border-l-2 border-[var(--accent)]/30 pl-4">
                        <div className="font-medium text-[var(--text-primary)]">{run.title}</div>
                        <div className="mt-0.5 text-sm text-[var(--text-secondary)]">{timeLabel}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>

          {/* Recent meetings section */}
          {recent.length > 0 && (
            <>
              <CardHeader className="mb-4 mt-6 border-t border-[var(--border-default)] pt-5">
                <CardTitle className="text-base text-[var(--text-secondary)]">Recent</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-dashed divide-[var(--border-default)]">
                  {recent.map((run) => {
                    const d = new Date(run.started);
                    const dayNum = d.getDate();
                    const monthLabel = d.toLocaleDateString("en-US", { month: "short" });
                    const dayOfWeek = d.toLocaleDateString("en-US", { weekday: "short" });
                    const timeLabel = relativeDateLabel(run.started);

                    return (
                      <button
                        key={run.run_id}
                        type="button"
                        className="flex w-full items-start gap-6 px-4 py-3 text-left transition-colors hover:bg-[var(--bg-secondary)]/50"
                        onClick={() => onOpenMeeting?.(run.folder_path)}
                      >
                        <div className="w-16 shrink-0 text-center">
                          <div className="flex items-baseline justify-center gap-1">
                            <span className="text-2xl font-light text-[var(--text-tertiary)]">{dayNum}</span>
                            <div className="text-xs text-[var(--text-tertiary)]">
                              <div>{monthLabel}</div>
                              <div>{dayOfWeek}</div>
                            </div>
                          </div>
                        </div>
                        <div className="min-w-0 flex-1 border-l border-[var(--border-default)] pl-4">
                          <div className="font-medium text-[var(--text-secondary)]">{run.title}</div>
                          <div className="mt-0.5 text-sm text-[var(--text-tertiary)]">{timeLabel}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </>
          )}

          {/* View all meetings link */}
          <div className="mt-4 border-t border-[var(--border-default)] pt-3 text-center">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
              onClick={() => onViewAllMeetings?.()}
            >
              View all meetings <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </Card>
      </PageScaffold>
    );
  }

  // ---- Render: DRAFT or RECORDING/PAUSED ----
  const currentTitle = isDraft ? draftTitle : (recording.title ?? "Untitled Meeting");
  const currentScheduledTime = isDraft ? draftScheduledTime : null;
  const currentStatus = isDraft ? "draft" : isPaused ? "paused" : "recording";

  return (
    <PageScaffold className="gap-4 overflow-hidden md:gap-5">
      {/* Unified header */}
      <MeetingHeader
        status={currentStatus}
        title={currentTitle}
        description={isDraft ? (draftDescription || undefined) : undefined}
        scheduledTime={currentScheduledTime}
        elapsed={isRecording ? elapsedLabel : undefined}
        onTitleSave={onTitleSave}
        onDescriptionSave={isDraft ? onDescriptionSave : undefined}
        onScheduledTimeChange={isDraft ? onScheduledTimeChange : undefined}
        onBack={onViewAllMeetings}
        actions={
          <>
            {isDraft && (
              <>
                <Button size="lg" onClick={onStart} disabled={starting}>
                  {starting ? <><Spinner /> Starting…</> : <><CirclePlay className="h-4 w-4" /> Start recording</>}
                </Button>
                <Button variant="ghost" size="sm" className="text-[var(--error)]" onClick={() => setConfirmDeleteOpen(true)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
            {isRecording && (
              <>
                <Button variant="secondary" onClick={onPause}>
                  <Pause className="h-4 w-4" /> Pause
                </Button>
                <Button onClick={() => { resetEndMeetingState(); setEndDialogOpen(true); }} disabled={stopping}>
                  <Square className="h-4 w-4" /> End meeting
                </Button>
              </>
            )}
            {isPaused && (
              <>
                <Button onClick={onResume}>
                  <Play className="h-4 w-4" /> Resume
                </Button>
                <Button variant="secondary" onClick={() => { resetEndMeetingState(); setEndDialogOpen(true); }} disabled={stopping}>
                  <Square className="h-4 w-4" /> End meeting
                </Button>
              </>
            )}
          </>
        }
      />

      {/* ---- DRAFT: tabbed content ---- */}
      {isDraft && (
        <Tabs value={draftTab} onValueChange={(v) => setDraftTab(v as typeof draftTab)} className="flex min-h-0 flex-1 flex-col">
          <TabsList>
            <TabsTrigger value="prep">Prep</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="analysis">Analysis</TabsTrigger>
            <TabsTrigger value="files">Files{attachments.length > 0 ? ` (${attachments.length})` : ""}</TabsTrigger>
          </TabsList>

          <TabsContent value="prep" forceMount className={draftTab !== "prep" ? "hidden" : ""}>
            <div className="flex-1 min-h-0 overflow-hidden rounded-md border border-[var(--border-default)] bg-white">
              <MarkdownEditor value={prepNotes} onChange={onPrepChange} />
            </div>
          </TabsContent>

          <TabsContent value="notes" forceMount className={draftTab !== "notes" ? "hidden" : ""}>
            <div className="flex-1 min-h-0 overflow-hidden rounded-md border border-[var(--border-default)] bg-white">
              <MarkdownEditor
                value={notes}
                onChange={onNotesChange}
                onBlur={() => {
                  const folder = activeRunFolder;
                  if (folder) api.runs.writeNotes(folder, notes).catch(() => {});
                }}
              />
            </div>
          </TabsContent>

          <TabsContent value="analysis">
            <div className="space-y-4">
              <p className="text-sm text-[var(--text-secondary)]">
                Select which analysis prompts to run automatically after recording.
              </p>
              {processSteps.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--border-default)] bg-[var(--bg-secondary)]/50 px-6 py-8 text-center text-sm text-[var(--text-secondary)]">
                  No analysis prompts available. Add prompts in the Prompts editor.
                </div>
              ) : (
                <div className="space-y-1">
                  {processSteps.filter((s) => s.id !== TRANSCRIPT_STEP_ID).map((step) => (
                    <label key={step.id} className="flex items-start gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-[var(--bg-secondary)]">
                      <Checkbox checked disabled={false} onCheckedChange={() => {}} className="mt-0.5" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-[var(--text-primary)]">{step.label}</span>
                        {step.description && <span className="mt-0.5 block text-xs text-[var(--text-tertiary)]">{step.description}</span>}
                        {step.modelNote && <span className="mt-0.5 block text-xs text-[var(--text-tertiary)]">{step.modelNote}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="files">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-[var(--text-primary)]">
                  Attached files ({attachments.length})
                </span>
                <Button variant="secondary" size="sm" onClick={onAddAttachment}>
                  <FileUp className="h-3.5 w-3.5" /> Add file
                </Button>
              </div>
              {attachments.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--border-default)] bg-[var(--bg-secondary)]/50 px-6 py-8 text-center text-sm text-[var(--text-secondary)]">
                  No files attached. Add reference documents, slides, or other materials.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {attachments.map((a) => (
                    <div key={a.name} className="flex items-center justify-between rounded-lg border border-[var(--border-default)] bg-white px-4 py-3">
                      <span className="min-w-0 truncate text-sm font-medium text-[var(--text-primary)]">{a.name}</span>
                      <Button variant="ghost" size="sm" onClick={() => onRemoveAttachment(a.name)} className="text-[var(--text-tertiary)] hover:text-[var(--error)]">
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      )}

      {/* ---- RECORDING/PAUSED: stacked content ---- */}
      {(isRecording || isPaused) && (
        <div className="space-y-4">
          {/* Prep notes — collapsible disclosure */}
          {prepNotes.trim() && (
            <DisclosurePanel label="Prep notes" icon={<NotebookPen className="h-4 w-4" />} defaultOpen>
              <div className="prose prose-sm max-w-none text-[var(--text-primary)]">
                <MarkdownView source={prepNotes} />
              </div>
            </DisclosurePanel>
          )}

          {/* Live notes — primary editor */}
          <div>
            <div className="mb-2 text-sm font-medium text-[var(--text-primary)]">Live notes</div>
            <div className="h-[60vh] overflow-hidden rounded-md border border-[var(--border-default)] bg-white">
              <MarkdownEditor
                value={notes}
                onChange={onNotesChange}
                onBlur={() => {
                  const folder = activeRunFolder;
                  if (folder) api.runs.writeNotes(folder, notes).catch(() => {});
                }}
              />
            </div>
          </div>

          {/* Compact capture health */}
          <div className="flex items-center gap-4 text-sm text-[var(--text-secondary)]">
            <LiveChannelMeters isRecording={isRecording} systemCapturing={recording.system_captured === true} />
            <span className={recording.system_captured ? "" : "text-[var(--warning-text)]"}>
              {recording.system_captured ? "System audio capturing" : "System audio not available"}
            </span>
          </div>

          {/* System audio warning banner */}
          {recording.system_audio_warning && (
            <div className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-muted)] px-4 py-3 text-sm text-[var(--warning-text)]">
              {recording.system_audio_warning}
            </div>
          )}

          {/* Pipeline progress */}
          {sections.length > 0 && (
            <PipelineStatus sections={sections} title="Live processing" />
          )}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-[var(--error)]/20 bg-[var(--error-muted)] px-4 py-3 text-sm text-[var(--error)]">
          {error}
        </div>
      )}

      {/* End meeting dialog */}
      <Dialog open={endDialogOpen} onOpenChange={(open) => { if (!open && !stopping) setEndDialogOpen(false); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>End meeting</DialogTitle>
            <DialogDescription>
              Stop the recording and choose what happens next.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <RadioGroup className="gap-3">
              <RadioGroupItem id="end-process" name="end-mode" checked={endMode === "process"} onChange={() => setEndMode("process")} label="Process meeting" description="Transcribe and run selected output steps." />
              <RadioGroupItem id="end-save" name="end-mode" checked={endMode === "save"} onChange={() => setEndMode("save")} label="Save without processing" description="Keep the recording for later." />
              <RadioGroupItem id="end-delete" name="end-mode" checked={endMode === "delete"} onChange={() => setEndMode("delete")} label="Delete meeting" description="Discard everything." />
            </RadioGroup>

            {endMode === "process" && (
              <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)]/50 p-4">
                <div className="text-sm font-medium text-[var(--text-primary)]">Processing steps</div>
                <div className="mt-3 space-y-2">
                  {processSteps.map((step) => {
                    const checked = selectedStepSet.has(step.id);
                    const disabled = step.id !== TRANSCRIPT_STEP_ID && !transcriptSelected;
                    return (
                      <label key={step.id} className="flex items-start gap-3 rounded-md border border-[var(--border-default)] bg-white px-3 py-2.5">
                        <Checkbox
                          checked={checked}
                          disabled={disabled}
                          onCheckedChange={(next) => {
                            const isChecked = next === true;
                            setSelectedProcessStepIds((prev) => {
                              if (step.id === TRANSCRIPT_STEP_ID) return isChecked ? [TRANSCRIPT_STEP_ID] : [];
                              if (!prev.includes(TRANSCRIPT_STEP_ID)) return prev;
                              return isChecked ? (prev.includes(step.id) ? prev : [...prev, step.id]) : prev.filter((id) => id !== step.id);
                            });
                          }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-[var(--text-primary)]">{step.label}</span>
                          {step.modelNote && <span className="mt-0.5 block text-xs text-[var(--text-tertiary)]">{step.modelNote}</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setEndDialogOpen(false)} disabled={stopping}>Keep recording</Button>
            <Button
              variant={endMode === "delete" ? "destructive" : "default"}
              onClick={() => void onConfirmEndMeeting()}
              disabled={stopping || processConfirmDisabled}
            >
              {stopping ? <><Spinner /> Saving…</> : endMode === "process" ? "End meeting" : endMode === "save" ? "Save meeting" : "Review delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={(open) => { if (!open && !stopping) setConfirmDeleteOpen(false); }}
        title={isDraft ? "Delete draft?" : "Delete meeting?"}
        description={isDraft ? "This will permanently delete this draft workspace and all its contents." : "This will stop the recording and permanently delete everything."}
        cancelLabel={isDraft ? "Keep draft" : "Keep meeting"}
        confirmLabel={isDraft ? "Delete draft" : "Delete meeting"}
        confirmingLabel="Deleting…"
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={() => void onDelete()}
        disabled={stopping}
      />
    </PageScaffold>
  );
}
