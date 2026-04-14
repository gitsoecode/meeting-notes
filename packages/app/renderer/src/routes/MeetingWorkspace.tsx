import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CirclePlay,
  ExternalLink,
  FileOutput,
  FileUp,
  Lock,
  LockOpen,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  NotebookPen,
  Pause,
  Play,
  PlayCircle,
  RefreshCcw,
  Search,
  Square,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../ipc-client";
import type {
  AppConfigDTO,
  JobSummary,
  PipelineProgressEvent,
  PromptRow,
  RecordingStatus,
  ReprocessRequest,
  RunDetail,
  RunManifest,
} from "../../../shared/ipc";
import {
  buildMeetingPromptCollections,
  PRIMARY_PROMPT_ID,
  type MeetingAnalysisPromptItem,
} from "../../../shared/meeting-prompts";
import { AudioMeter } from "../components/AudioMeter";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DisclosurePanel } from "../components/DisclosurePanel";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "../components/ui/resizable";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { MarkdownView } from "../components/MarkdownView";
import { MeetingHeader } from "../components/MeetingHeader";
import { OverviewPanel } from "../components/OverviewPanel";
import { ChatLauncherModal } from "../components/ChatLauncherModal";
import { PageScaffold } from "../components/PageScaffold";
import {
  PipelineStatus,
  applyProgress,
  CancelJobButton,
  outputsFromJobSteps,
  type PromptOutputStatus,
} from "../components/PipelineStatus";
import { TranscriptView } from "../components/TranscriptView";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Input } from "../components/ui/input";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group";
import { Spinner } from "../components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { getDefaultPromptModel, getPromptModelSummary } from "../lib/prompt-metadata";
import { findModelEntry } from "../../../shared/llm-catalog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MeetingWorkspaceProps {
  runFolder: string;
  recording: RecordingStatus;
  config: AppConfigDTO;
  onBack: () => void;
  onOpenMeeting: (runFolder: string) => void;
  onOpenPromptLibrary: (promptId?: string) => void;
  onDirtyChange?: (isDirty: boolean) => void;
}

type TabKind = "prep" | "notes" | "summary" | "analysis" | "transcript" | "recording" | "files" | "metadata";

type EndMeetingMode = "process" | "save" | "delete";

type PendingConfirmState = {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  confirmingLabel?: string;
  confirmVariant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  action: () => Promise<void> | void;
};

interface ProcessStep {
  id: string;
  label: string;
  description: string | null;
  modelNote: string | null;
  promptId?: string;
}

const TRANSCRIPT_STEP_ID = "__transcript__";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatModelNote(prompt: Pick<PromptRow, "model"> | null | undefined, defaultModel: string | null) {
  const model = getPromptModelSummary(prompt, defaultModel);
  if (!model.id) return "Model unavailable";
  const displayLabel = model.rawId ?? model.label;
  if (model.providerLabel === "Local model") return `Uses local model ${displayLabel}`;
  return `Uses ${model.label}`;
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getRecordingExtension(fileName: string): string {
  const baseName = fileName.split("/").pop() ?? fileName;
  const match = baseName.match(/\.([^.]+)$/);
  return match ? `.${match[1].toLowerCase()}` : "";
}

function isAudioRecording(fileName: string): boolean {
  return [".mp3", ".m4a", ".wav", ".aiff", ".flac", ".ogg"].includes(getRecordingExtension(fileName));
}

function isVideoRecording(fileName: string): boolean {
  return [".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"].includes(getRecordingExtension(fileName));
}

function getRecordingTypeLabel(fileName: string): string {
  if (isAudioRecording(fileName)) return "Audio recording";
  if (isVideoRecording(fileName)) return "Video recording";
  return "Recording";
}

function sortAnalysisPrompts(left: MeetingAnalysisPromptItem, right: MeetingAnalysisPromptItem) {
  if (left.prompt.sort_order != null && right.prompt.sort_order != null && left.prompt.sort_order !== right.prompt.sort_order) {
    return left.prompt.sort_order - right.prompt.sort_order;
  }
  if (left.prompt.sort_order != null && right.prompt.sort_order == null) return -1;
  if (left.prompt.sort_order == null && right.prompt.sort_order != null) return 1;
  return left.label.localeCompare(right.label);
}

function formatAnalysisPromptMeta(prompt: MeetingAnalysisPromptItem, defaultModel: string | null): string {
  const parts = [prompt.prompt.auto ? "Auto-run prompt" : "Manual prompt"];
  if (prompt.status === "running") parts.push("Running");
  else if (prompt.status === "failed") parts.push("Last run failed");
  else if (prompt.status === "queued") parts.push("Queued");
  else if (prompt.hasOutput) parts.push("Output ready");
  else parts.push("No output yet");

  const effectiveModel = prompt.prompt.model ?? defaultModel;
  if (effectiveModel) {
    const entry = findModelEntry(effectiveModel);
    parts.push(entry?.label ?? effectiveModel);
  }

  return parts.join(" • ");
}

function buildAnalysisSignature(detail: RunDetail | null): string {
  if (!detail) return "";
  const manifestOutputs = Object.entries(detail.manifest?.prompt_outputs ?? {})
    .map(([id, section]) => [id, section?.status ?? "", section?.filename ?? ""])
    .sort(([left], [right]) => (left as string).localeCompare(right as string));
  const files = detail.files
    .filter((file) => file.kind === "document" && file.name.endsWith(".md"))
    .map((file) => [file.name, file.size] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify({ status: detail.status, manifestOutputs, files });
}

// ---------------------------------------------------------------------------
// Empty tab placeholder
// ---------------------------------------------------------------------------

function EmptyTabContent({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-sm text-[var(--text-tertiary)]">{message}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MeetingWorkspace
// ---------------------------------------------------------------------------

export function MeetingWorkspace({
  runFolder,
  recording,
  config,
  onBack,
  onOpenMeeting,
  onOpenPromptLibrary,
  onDirtyChange,
}: MeetingWorkspaceProps) {
  // ---- Core state ----
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- Tab state ----
  const [activeTabId, setActiveTabId] = useState<TabKind>("metadata");
  const [tabContents, setTabContents] = useState<Record<string, string>>({});
  const [documentReloadVersion, setDocumentReloadVersion] = useState(0);

  // ---- Prep / Notes state ----
  const [prepNotes, setPrepNotes] = useState("");
  const [prepLocked, setPrepLocked] = useState(true);
  const [notes, setNotes] = useState("");
  const [notesEditMode, setNotesEditMode] = useState(false);
  const initialNotesRef = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const prepSaveTimer = useRef<number | null>(null);

  // ---- Analysis state ----
  const [activePromptId, setActivePromptId] = useState<string | null>(null);
  const [analysisSearchQuery, setAnalysisSearchQuery] = useState("");
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [loadingPrompts, setLoadingPrompts] = useState(true);

  // ---- Pipeline / reprocess state ----
  const [sections, setSections] = useState<PromptOutputStatus[]>([]);
  const [activeJob, setActiveJob] = useState<JobSummary | null>(null);
  const [reprocessOpen, setReprocessOpen] = useState(false);
  const [reprocessStarting, setReprocessStarting] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  // ---- Recording state ----
  const [elapsedSec, setElapsedSec] = useState(0);
  const [stopMode, setStopMode] = useState<EndMeetingMode | null>(null);
  const [endDialogOpen, setEndDialogOpen] = useState(false);
  const [endMode, setEndMode] = useState<EndMeetingMode>("process");
  const [selectedProcessStepIds, setSelectedProcessStepIds] = useState<string[]>([]);

  // ---- Media state ----
  const [recordingSources, setRecordingSources] = useState<Record<string, string>>({});
  const [recordingToDelete, setRecordingToDelete] = useState<string | null>(null);
  const [deletingRecording, setDeletingRecording] = useState(false);

  // ---- Files state ----
  const [attachments, setAttachments] = useState<Array<{ name: string; size: number }>>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(true);

  // ---- View mode ----
  const [focusedRecording, setFocusedRecording] = useState(true);

  // ---- Dialog state ----
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [chatLauncherOpen, setChatLauncherOpen] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmState | null>(null);
  const [confirmingAction, setConfirmingAction] = useState(false);

  const detailSignatureRef = useRef("");

  // ---- Derived state ----
  const isRecordingThis = recording.active && recording.run_folder === runFolder;
  const isDraft = detail?.status === "draft" && !isRecordingThis;
  const isRecording = isRecordingThis && !recording.paused;
  const isPaused = (isRecordingThis && !!recording.paused) || (!isRecordingThis && detail?.status === "paused");
  const isProcessing = detail?.status === "processing";
  const isComplete = detail?.status === "complete";
  const isError = detail?.status === "error";
  const isLive = isRecording || isPaused;
  const stopping = stopMode !== null;

  // Detect "reopened from complete" drafts
  const wasCompleted = useMemo(() => {
    if (!isDraft || !detail) return false;
    const sections = detail.manifest?.prompt_outputs ?? {};
    return Object.values(sections).some((s) => s?.status === "complete");
  }, [isDraft, detail]);

  const effectiveStatus = isRecording ? "recording" : isPaused ? "paused" : (detail?.status ?? "draft");

  // ---- Load detail ----
  const invalidateAnalysisCache = (promptOutputId?: string | null) => {
    setTabContents((prev) => {
      if (promptOutputId) {
        const cacheKey = promptOutputId === PRIMARY_PROMPT_ID ? "summary" : `prompt:${promptOutputId}`;
        if (!(cacheKey in prev)) return prev;
        const next = { ...prev };
        delete next[cacheKey];
        return next;
      }
      let changed = false;
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(prev)) {
        if (key === "summary" || key.startsWith("prompt:")) { changed = true; continue; }
        next[key] = value;
      }
      return changed ? next : prev;
    });
    setDocumentReloadVersion((prev) => prev + 1);
  };

  const refresh = async () => {
    if (deletedRef.current) return;
    setLoading(true);
    try {
      const nextDetail = await api.runs.get(runFolder);
      const nextSignature = buildAnalysisSignature(nextDetail);
      if (detailSignatureRef.current !== nextSignature) invalidateAnalysisCache();
      detailSignatureRef.current = nextSignature;
      setDetail(nextDetail);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    setTabContents({});
    setActiveTabId("metadata");
    setActivePromptId(null);
    setAnalysisSearchQuery("");
    setPrompts([]);
    setLoadingPrompts(true);
    setSections([]);
    setReprocessStarting(false);
    setPipelineError(null);
    setNotesEditMode(false);
    setRecordingSources({});
    setRecordingToDelete(null);
    setDeletingRecording(false);
    setElapsedSec(0);
    setPrepLocked(true);
    detailSignatureRef.current = "";
    initialNotesRef.current = null;
  }, [runFolder]);

  // ---- Load prep + notes ----
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const prep = await api.runs.readPrep(runFolder);
        if (!cancelled) setPrepNotes(prep);
        const n = await api.runs.readDocument(runFolder, "notes.md").catch(() => "");
        if (!cancelled) setNotes(n);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [runFolder]);

  // ---- Load attachments ----
  useEffect(() => {
    setAttachmentsLoading(true);
    api.runs.listAttachments(runFolder)
      .then(setAttachments)
      .catch(() => setAttachments([]))
      .finally(() => setAttachmentsLoading(false));
  }, [runFolder]);

  // ---- Load prompts ----
  useEffect(() => {
    let alive = true;
    setLoadingPrompts(true);
    void api.prompts.list()
      .then((list) => { if (alive) setPrompts(list); })
      .catch(() => { if (alive) setPrompts([]); })
      .finally(() => { if (alive) setLoadingPrompts(false); });
    return () => { alive = false; };
  }, [runFolder]);

  // ---- Pipeline progress ----
  useEffect(() => {
    const unsub = api.on.pipelineProgress((event: PipelineProgressEvent) => {
      if (event.runFolder !== runFolder) return;
      setReprocessStarting(false);
      if (event.type === "run-failed") setPipelineError(event.error);
      else if (event.type === "output-start" || event.type === "run-complete") setPipelineError(null);
      setSections((prev) => applyProgress(prev, event));
      if (event.type === "output-complete") {
        invalidateAnalysisCache(event.promptOutputId);
        void refresh();
        return;
      }
      if (event.type === "run-complete" || event.type === "run-failed") {
        invalidateAnalysisCache();
        void refresh();
      }
    });
    return () => unsub();
  }, [runFolder]);

  // ---- Job tracking ----
  useEffect(() => {
    let canceled = false;
    api.jobs.list().then((allJobs) => {
      if (canceled) return;
      setActiveJob(
        allJobs.find((job) => job.runFolder === runFolder && (job.status === "queued" || job.status === "running")) ?? null
      );
    }).catch(() => {});
    const unsub = api.on.jobUpdate((job) => {
      if (job.runFolder !== runFolder) return;
      if (job.status === "queued" || job.status === "running") { setActiveJob(job); return; }
      setActiveJob((current) => (current?.id === job.id ? null : current));
    });
    return () => { canceled = true; unsub(); };
  }, [runFolder]);

  useEffect(() => {
    if (!activeJob?.progress.steps?.length) return;
    setSections(outputsFromJobSteps(activeJob.progress.steps));
  }, [activeJob]);

  // Poll for updates when processing
  useEffect(() => {
    if (!detail || detail.status !== "processing") return;
    const id = setInterval(() => { void refresh(); }, 7000);
    return () => clearInterval(id);
  }, [detail?.status, runFolder]);

  // ---- Elapsed timer ----
  useEffect(() => {
    if (!isRecording || !recording.started_at) { setElapsedSec(0); return; }
    const start = new Date(recording.started_at).getTime();
    const update = () => setElapsedSec(Math.floor((Date.now() - start) / 1000));
    update();
    const id = window.setInterval(update, 1000);
    return () => clearInterval(id);
  }, [isRecording, recording.started_at]);

  // Reset recording state and refresh detail when recording ends
  const prevRecordingRef = useRef(isRecordingThis);
  useEffect(() => {
    if (!isRecordingThis) {
      setEndDialogOpen(false);
      setConfirmDeleteOpen(false);
      setEndMode("process");
      setSelectedProcessStepIds([]);
    }
    // Refresh detail when recording transitions from active to inactive (unless deleted)
    if (prevRecordingRef.current && !isRecordingThis && !deletedRef.current) {
      void refresh();
      setFocusedRecording(false);
    }
    // Enter focused mode when recording starts
    if (!prevRecordingRef.current && isRecordingThis) {
      setFocusedRecording(true);
    }
    prevRecordingRef.current = isRecordingThis;
  }, [isRecordingThis]);

  // ---- Analysis computations ----
  const defaultModel = useMemo(() => getDefaultPromptModel(config), [config]);

  const promptCollections = useMemo(() => {
    if (!detail) return { primaryPrompt: null, summaryFileName: "summary.md", summaryStatus: undefined, summaryHasOutput: false, analysisPrompts: [] as MeetingAnalysisPromptItem[] };
    const manifest = (detail.manifest ?? {}) as { sections?: Record<string, { filename?: string; label?: string; status?: string }> };
    return buildMeetingPromptCollections({
      prompts,
      manifestOutputs: manifest.prompt_outputs ?? {},
      files: detail.files.filter((f): f is typeof f & { kind?: "document" | "log" | "media" } => f.kind !== "attachment"),
    });
  }, [detail, prompts]);

  const sortedAnalysisPrompts = useMemo(() => [...promptCollections.analysisPrompts].sort(sortAnalysisPrompts), [promptCollections.analysisPrompts]);
  const filteredAnalysisPrompts = useMemo(() => {
    const query = analysisSearchQuery.trim().toLowerCase();
    if (!query) return sortedAnalysisPrompts;
    return sortedAnalysisPrompts.filter((p) => p.label.toLowerCase().includes(query) || p.id.toLowerCase().includes(query) || (p.description?.toLowerCase().includes(query) ?? false));
  }, [analysisSearchQuery, sortedAnalysisPrompts]);
  const analysisPreloadedPrompts = useMemo(() => filteredAnalysisPrompts.filter((p) => p.prompt.builtin), [filteredAnalysisPrompts]);
  const analysisCustomPrompts = useMemo(() => filteredAnalysisPrompts.filter((p) => !p.prompt.builtin), [filteredAnalysisPrompts]);

  useEffect(() => {
    if (activePromptId && sortedAnalysisPrompts.some((p) => p.id === activePromptId)) return;
    const firstComplete = sortedAnalysisPrompts.find((p) => p.status === "complete" && p.hasOutput) ?? sortedAnalysisPrompts[0];
    setActivePromptId(firstComplete?.id ?? null);
  }, [activePromptId, sortedAnalysisPrompts]);

  const recordingFiles = useMemo(() => (detail ? detail.files.filter((f) => f.kind === "media") : []), [detail]);

  // ---- Process steps (for end-meeting dialog) ----
  const processSteps = useMemo<ProcessStep[]>(() => {
    const summaryPrompt = prompts.find((p) => p.id === PRIMARY_PROMPT_ID) ?? null;
    const autoPrompts = prompts.filter((p) => p.id !== PRIMARY_PROMPT_ID && p.enabled && p.auto);
    return [
      { id: TRANSCRIPT_STEP_ID, label: "Transcribe", description: "Create transcript from the recording.", modelNote: null },
      { id: PRIMARY_PROMPT_ID, label: summaryPrompt?.label ?? "Summary", description: summaryPrompt?.description ?? "Generate meeting summary.", modelNote: formatModelNote(summaryPrompt, defaultModel), promptId: PRIMARY_PROMPT_ID },
      ...autoPrompts.map((p) => ({ id: p.id, label: p.label, description: p.description, modelNote: formatModelNote(p, defaultModel), promptId: p.id })),
    ];
  }, [defaultModel, prompts]);

  const selectedStepSet = useMemo(() => new Set(selectedProcessStepIds), [selectedProcessStepIds]);
  const transcriptSelected = selectedStepSet.has(TRANSCRIPT_STEP_ID);
  const processConfirmDisabled = endMode === "process" && !transcriptSelected;

  // ---- Load recording sources ----
  useEffect(() => {
    if (activeTabId !== "recording" || recordingFiles.length === 0) return;
    const missing = recordingFiles.filter((f) => !recordingSources[f.name]);
    if (missing.length === 0) return;
    let canceled = false;
    void Promise.all(
      missing.map(async (file) => {
        try {
          const source = await api.runs.getMediaSource(runFolder, file.name);
          if (canceled) return null;
          return [file.name, source] as const;
        } catch { return null; }
      })
    ).then((entries) => {
      if (canceled) return;
      setRecordingSources((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const entry of entries) {
          if (!entry) continue;
          const [name, source] = entry;
          if (next[name] === source) continue;
          next[name] = source;
          changed = true;
        }
        return changed ? next : prev;
      });
    });
    return () => { canceled = true; };
  }, [activeTabId, recordingFiles, recordingSources, runFolder]);

  // ---- Load tab content (summary, analysis output, transcript, notes) ----
  useEffect(() => {
    if (!detail) return;
    let filePath: string | null = null;
    let cacheKey: string | null = null;
    if (activeTabId === "summary") { filePath = promptCollections.summaryFileName; cacheKey = "summary"; }
    else if (activeTabId === "notes" && !isDraft && !isLive) { filePath = "notes.md"; cacheKey = "notes"; }
    else if (activeTabId === "transcript") { filePath = "transcript.md"; cacheKey = "transcript"; }
    else if (activeTabId === "analysis" && activePromptId) {
      const ap = promptCollections.analysisPrompts.find((p) => p.id === activePromptId);
      if (ap) { filePath = ap.fileName; cacheKey = `prompt:${ap.id}`; }
    }
    if (!filePath || !cacheKey || tabContents[cacheKey] != null) return;
    api.runs.readDocument(runFolder, filePath)
      .then((content) => {
        setTabContents((prev) => ({ ...prev, [cacheKey!]: content }));
        if (cacheKey === "notes") initialNotesRef.current = content;
      })
      .catch((err) => {
        if (err instanceof Error && /ENOENT/i.test(err.message)) return;
        setTabContents((prev) => ({ ...prev, [cacheKey!]: "_(unable to load file)_" }));
      });
  }, [activePromptId, activeTabId, detail, documentReloadVersion, promptCollections.analysisPrompts, promptCollections.summaryFileName, runFolder, tabContents, isDraft, isLive]);

  // ---- Dirty state ----
  const isCompletedMeeting = detail != null && !["draft", "recording", "processing"].includes(detail.status);
  const isNotesDirty = notesEditMode && isCompletedMeeting && tabContents.notes !== initialNotesRef.current;

  useEffect(() => { onDirtyChange?.(isNotesDirty); }, [isNotesDirty, onDirtyChange]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isNotesDirty) { e.preventDefault(); e.returnValue = "unsaved"; return e.returnValue; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isNotesDirty]);

  // ---- Actions ----
  const onStart = async () => {
    setError(null);
    try {
      await api.recording.startForDraft({ runFolder });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onPause = async () => {
    try { await api.recording.pause(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  const onResume = async () => {
    try { await api.recording.resume(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  const flushNotes = async () => {
    await api.runs.writeNotes(runFolder, notes).catch(() => {});
  };

  const resetEndMeetingState = () => {
    setEndMode("process");
    setSelectedProcessStepIds(processSteps.map((s) => s.id));
    setConfirmDeleteOpen(false);
    setError(null);
  };

  const deletedRef = useRef(false);

  const finalizeStop = async (mode: EndMeetingMode) => {
    await flushNotes();
    if (mode === "delete") {
      deletedRef.current = true;
      await api.recording.stop({ mode: "delete" });
      setNotes("");
      onBack();
      return;
    }
    const result = await api.recording.stop({ mode: "save" });
    if (!result?.run_folder) return;
    if (mode === "process") {
      const onlyIds = selectedProcessStepIds.filter((id) => id !== TRANSCRIPT_STEP_ID);
      await api.runs.startProcessRecording({ runFolder: result.run_folder, onlyIds });
    }
    onOpenMeeting(result.run_folder);
  };

  const onConfirmEndMeeting = async () => {
    setError(null);
    if (endMode === "delete") { setEndDialogOpen(false); setConfirmDeleteOpen(true); return; }
    setStopMode(endMode);
    try { await finalizeStop(endMode); setEndDialogOpen(false); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setStopMode(null); }
  };

  const startReprocess = async (request: ReprocessRequest) => {
    await api.runs.startReprocess(request);
    setSections([]);
    setPipelineError(null);
    setReprocessStarting(true);
    void refresh();
  };

  const onDelete = async () => {
    setPendingConfirm({
      title: isDraft ? "Delete draft?" : "Delete meeting?",
      description: isDraft ? "This will permanently delete this draft workspace and all its contents." : "This permanently deletes the meeting and all of its files from disk.",
      confirmLabel: isDraft ? "Delete draft" : "Delete meeting",
      confirmingLabel: "Deleting…",
      cancelLabel: isDraft ? "Keep draft" : "Keep meeting",
      confirmVariant: "destructive",
      action: async () => {
        deletedRef.current = true;
        if (prepSaveTimer.current != null) window.clearTimeout(prepSaveTimer.current);
        if (isLive) {
          await api.recording.stop({ mode: "delete" });
          setNotes("");
        } else {
          await api.runs.deleteRun(runFolder);
        }
        onBack();
      },
    });
  };

  const onNotesChange = (value: string) => {
    if (isDraft || isLive) {
      setNotes(value);
    } else {
      setTabContents((prev) => ({ ...prev, notes: value }));
    }
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { api.runs.writeNotes(runFolder, value).catch(() => {}); }, 400);
  };

  const onPrepChange = (value: string) => {
    setPrepNotes(value);
    if (prepSaveTimer.current != null) window.clearTimeout(prepSaveTimer.current);
    prepSaveTimer.current = window.setTimeout(() => { api.runs.writePrep(runFolder, value).catch(() => {}); }, 400);
  };

  const saveCompletedNotes = async () => {
    if (tabContents.notes == null) return;
    await api.runs.writeNotes(runFolder, tabContents.notes);
    initialNotesRef.current = tabContents.notes;
    setNotesEditMode(false);
  };

  const requestNotesDiscard = (action: () => void, description = "You have unsaved notes. Discard your changes and continue?") => {
    if (!isNotesDirty) { action(); return; }
    setPendingConfirm({
      title: "Discard note changes?",
      description,
      confirmLabel: "Discard changes",
      cancelLabel: "Keep editing",
      action,
    });
  };

  const onConfirmPendingAction = async () => {
    if (!pendingConfirm) return;
    setConfirmingAction(true);
    try { await pendingConfirm.action(); setPendingConfirm(null); }
    finally { setConfirmingAction(false); }
  };

  const onTitleSave = (newTitle: string) => {
    if (!newTitle.trim()) return;
    api.runs.updateMeta({ runFolder, title: newTitle.trim() }).catch(() => {});
    setDetail((prev) => prev ? { ...prev, title: newTitle.trim() } : prev);
  };

  const onDescriptionSave = (value: string) => {
    api.runs.updateMeta({ runFolder, description: value.trim() || null }).catch(() => {});
    setDetail((prev) => prev ? { ...prev, description: value.trim() || null } : prev);
  };

  const onScheduledTimeChange = (iso: string | null) => {
    api.runs.updatePrep({ runFolder, scheduledTime: iso }).catch(() => {});
    setDetail((prev) => prev ? { ...prev, scheduled_time: iso } : prev);
  };

  const onAddAttachment = async () => {
    const result = await api.runs.addAttachment(runFolder);
    if (result) setAttachments((prev) => [...prev, { name: result.fileName, size: result.size }]);
  };

  const onRemoveAttachment = async (name: string) => {
    await api.runs.removeAttachment(runFolder, name);
    setAttachments((prev) => prev.filter((a) => a.name !== name));
  };

  const onDownloadRecording = async (fileName: string) => {
    await api.runs.downloadMedia(runFolder, fileName);
  };

  const onConfirmDeleteRecording = async () => {
    const target = recordingFiles.find((f) => f.name === recordingToDelete);
    if (!target) return;
    setDeletingRecording(true);
    try {
      await api.runs.deleteMedia(runFolder, target.name);
      setRecordingSources((prev) => {
        if (!(target.name in prev)) return prev;
        const next = { ...prev };
        delete next[target.name];
        return next;
      });
      setRecordingToDelete(null);
      await refresh();
    } finally { setDeletingRecording(false); }
  };

  // ---- Computed values ----
  const elapsedLabel = useMemo(() => {
    const h = Math.floor(elapsedSec / 3600);
    const m = Math.floor((elapsedSec % 3600) / 60);
    const s = elapsedSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }, [elapsedSec]);

  const summaryContent = tabContents.summary ?? "";
  const completedNotesContent = tabContents.notes ?? "";
  const transcriptContent = tabContents.transcript ?? "";
  const activePrompt = activePromptId ? sortedAnalysisPrompts.find((p) => p.id === activePromptId) ?? null : null;
  const promptContent = activePromptId ? tabContents[`prompt:${activePromptId}`] ?? "" : "";

  const hasSummaryContent = promptCollections.summaryHasOutput;
  const hasTranscript = detail?.files.some((f) => f.name === "transcript.md" && f.size > 0) ?? false;

  const showPipelineStatus = reprocessStarting || detail?.status === "processing" || sections.length > 0 || pipelineError != null || activeJob != null;

  const pipelineStatusContent = showPipelineStatus ? (
    <div className="space-y-3">
      <PipelineStatus
        sections={sections}
        title={reprocessStarting && sections.length === 0 ? "Reprocess queued for this meeting" : "Processing"}
        description={pipelineError ? pipelineError : reprocessStarting && sections.length === 0 ? "The job has started in the background." : activeJob?.subtitle ?? "Outputs update in place as each step finishes."}
        status={activeJob?.status ?? "processing"}
        queuePosition={activeJob?.queuePosition}
        currentLabel={activeJob?.progress.currentOutputLabel}
        showPreparingWhenEmpty
        action={activeJob?.cancelable ? <CancelJobButton jobId={activeJob.id} onCancel={(jobId) => api.jobs.cancel(jobId)} /> : undefined}
      />
      {pipelineError ? (
        <div className="flex items-start gap-3 rounded-lg border border-[color:rgba(185,28,28,0.18)] bg-[rgba(185,28,28,0.06)] px-4 py-3 text-sm text-[var(--error)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>{pipelineError}</div>
        </div>
      ) : null}
    </div>
  ) : null;

  // ---- Render: loading / error / not found ----
  if (loading && !detail) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-[var(--border-default)] bg-white px-4 py-4 text-sm text-[var(--text-secondary)]">
        <Spinner /> Loading meeting…
      </div>
    );
  }
  if (error && !detail) {
    return (
      <div className="rounded-lg border border-[var(--error)]/20 bg-[var(--error-muted)] px-4 py-3 text-sm text-[var(--error)]">{error}</div>
    );
  }
  if (!detail) {
    return (
      <div className="rounded-lg border border-[var(--border-default)] bg-white px-4 py-4 text-sm text-[var(--text-secondary)]">Meeting not found.</div>
    );
  }

  // ---- Header actions by state ----
  const headerActions = (
    <>
      {isDraft && (
        <Button onClick={onStart}>
          <CirclePlay className="h-4 w-4" /> Start recording
        </Button>
      )}
      {isDraft && wasCompleted && (
        <Button variant="secondary" onClick={async () => {
          try {
            await api.runs.markComplete(runFolder);
            await refresh();
          } catch (err) {
            console.error("Mark complete failed", err);
          }
        }}>
          Mark complete
        </Button>
      )}
      {isRecording && (
        <>
          <Button variant="secondary" onClick={onPause}><Pause className="h-4 w-4" /> Pause</Button>
          <Button onClick={() => { resetEndMeetingState(); setEndDialogOpen(true); }} disabled={stopping}>
            <Square className="h-4 w-4" /> End meeting
          </Button>
        </>
      )}
      {isPaused && (
        <>
          <Button onClick={async () => {
            try {
              if (isRecordingThis) {
                await api.recording.resume();
              } else {
                await api.recording.continueRecording({ runFolder });
              }
            } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
          }}><Play className="h-4 w-4" /> Resume</Button>
          <Button variant="secondary" onClick={() => { resetEndMeetingState(); setEndDialogOpen(true); }} disabled={stopping}>
            <Square className="h-4 w-4" /> End meeting
          </Button>
        </>
      )}
      {isComplete && (
        <Button variant="secondary" size="sm" onClick={async () => {
          try { await api.recording.continueRecording({ runFolder }); }
          catch (err) { console.error("Continue recording failed", err); }
        }}>
          <PlayCircle className="h-3.5 w-3.5" /> Continue recording
        </Button>
      )}
      {isError && (
        <Button size="sm" onClick={() => setReprocessOpen(true)}>
          <RefreshCcw className="h-3.5 w-3.5" /> Reprocess
        </Button>
      )}
      <Button variant="secondary" size="sm" onClick={() => setChatLauncherOpen(true)}>
        <ExternalLink className="h-3.5 w-3.5" /> Launch chat
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {(isComplete || isError) && (
            <DropdownMenuItem onSelect={() => setReprocessOpen(true)}>Reprocess</DropdownMenuItem>
          )}
          {(isComplete || isError) && (
            <DropdownMenuItem onSelect={async () => {
              try { await api.runs.reopenAsDraft(runFolder); await refresh(); }
              catch (err) { console.error("Reopen as draft failed", err); }
            }}>
              Edit as draft
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => api.runs.openInFinder(runFolder)}>Open folder</DropdownMenuItem>
          {!isRecording && (
            <DropdownMenuItem onSelect={() => void onDelete()} className="text-[var(--error)]">
              {isDraft ? "Delete draft" : "Delete meeting"}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  return (
    <PageScaffold className={`gap-4 md:gap-5 ${isLive && focusedRecording ? "" : "overflow-hidden"}`}>
      <MeetingHeader
        status={effectiveStatus}
        title={detail.title}
        description={detail.description}
        scheduledTime={detail.scheduled_time}
        duration={detail.duration_minutes}
        elapsed={isRecording ? elapsedLabel : undefined}
        timestamp={detail.started || detail.date}
        onTitleSave={isProcessing ? undefined : onTitleSave}
        onDescriptionSave={isProcessing ? undefined : onDescriptionSave}
        onScheduledTimeChange={isDraft ? onScheduledTimeChange : undefined}
        onBack={() => requestNotesDiscard(onBack)}
        actions={headerActions}
      />

      {/* ---- Focused recording view — side-by-side prep + notes ---- */}
      {isLive && focusedRecording ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {/* Toggle to full workspace */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={() => setFocusedRecording(false)}
              className="inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            >
              <Maximize2 className="h-3.5 w-3.5" /> View full workspace
            </button>
          </div>

          {/* Resizable side-by-side panes */}
          <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0 rounded-lg border border-[var(--border-subtle)] bg-white">
            {/* Prep pane */}
            <ResizablePanel defaultSize={35} minSize={20}>
              <div className="flex h-full flex-col">
                <div className="flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2">
                  <span className="text-sm font-medium text-[var(--text-primary)]">Prep</span>
                  <Button variant="ghost" size="sm" onClick={() => setPrepLocked(!prepLocked)} className="h-7 w-7 p-0" title={prepLocked ? "Unlock editing" : "Lock editing"}>
                    {prepLocked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                {prepLocked ? (
                  <div className="flex-1 min-h-0 overflow-y-auto p-4">
                    {prepNotes.trim() ? (
                      <div className="prose prose-sm max-w-none text-[var(--text-primary)]">
                        <MarkdownView source={prepNotes} />
                      </div>
                    ) : (
                      <span className="text-sm text-[var(--text-tertiary)]">No prep notes.</span>
                    )}
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <MarkdownEditor value={prepNotes} onChange={onPrepChange} />
                  </div>
                )}
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Notes pane */}
            <ResizablePanel defaultSize={65} minSize={30}>
              <div className="flex h-full flex-col">
                <div className="shrink-0 border-b border-[var(--border-subtle)] px-3 py-2">
                  <span className="text-sm font-medium text-[var(--text-primary)]">Live notes</span>
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                  <MarkdownEditor
                    value={notes}
                    onChange={onNotesChange}
                    onBlur={() => { api.runs.writeNotes(runFolder, notes).catch(() => {}); }}
                  />
                </div>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>

          {/* Compact capture health + pipeline */}
          <div className="shrink-0 space-y-2">
            <div className="flex items-center gap-4 text-sm text-[var(--text-secondary)]">
              <AudioMeter label="Mic" active={isRecording} />
              <span>·</span>
              <span className={recording.system_captured ? "" : "text-[var(--warning-text)]"}>
                {recording.system_captured ? "System audio capturing" : "System audio not available"}
              </span>
            </div>
            {recording.system_audio_warning && (
              <div className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-muted)] px-4 py-3 text-sm text-[var(--warning-text)]">
                {recording.system_audio_warning}
              </div>
            )}
            {sections.length > 0 && <PipelineStatus sections={sections} title="Live processing" />}
          </div>
        </div>
      ) : (
      <>

      {/* Toggle back to focused recording */}
      {isLive && !focusedRecording && (
        <button
          type="button"
          onClick={() => setFocusedRecording(true)}
          className="inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
        >
          <Minimize2 className="h-3.5 w-3.5" /> Focus on recording
        </button>
      )}

      {/* ---- Unified tab bar ---- */}
      <Tabs
        value={activeTabId}
        onValueChange={(value) => {
          requestNotesDiscard(() => {
            setNotesEditMode(false);
            setActiveTabId(value as TabKind);
          });
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList>
          <TabsTrigger value="metadata">Metadata</TabsTrigger>
          <TabsTrigger value="prep">Prep</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="analysis">Analysis</TabsTrigger>
          <TabsTrigger value="transcript">Transcript</TabsTrigger>
          <TabsTrigger value="recording">Recording</TabsTrigger>
          <TabsTrigger value="files">Files{attachments.length > 0 ? ` (${attachments.length})` : ""}</TabsTrigger>
        </TabsList>

        {/* ---- PREP TAB ---- */}
        <TabsContent value="prep" forceMount className={activeTabId !== "prep" ? "hidden" : ""}>
          {isDraft ? (
            <div className="flex-1 min-h-0 overflow-hidden rounded-md border border-[var(--border-default)] bg-white">
              <MarkdownEditor value={prepNotes} onChange={onPrepChange} />
            </div>
          ) : isLive ? (
            <DisclosurePanel
              label="Prep notes"
              icon={<NotebookPen className="h-4 w-4" />}
              defaultOpen={!!prepNotes.trim()}
              actions={
                <Button variant="ghost" size="sm" onClick={() => setPrepLocked(!prepLocked)} className="h-7 w-7 p-0" title={prepLocked ? "Unlock editing" : "Lock editing"}>
                  {prepLocked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
                </Button>
              }
            >
              {prepLocked ? (
                <div className="prose prose-sm max-w-none text-[var(--text-primary)]">
                  {prepNotes.trim() ? <MarkdownView source={prepNotes} /> : <span className="text-[var(--text-tertiary)]">No prep notes.</span>}
                </div>
              ) : (
                <div className="h-[40vh] overflow-hidden rounded-md border border-[var(--border-default)] bg-white">
                  <MarkdownEditor value={prepNotes} onChange={onPrepChange} />
                </div>
              )}
            </DisclosurePanel>
          ) : prepNotes.trim() || !prepLocked ? (
            <div className="relative flex min-h-0 flex-1 flex-col rounded-md border border-[var(--border-default)] bg-white">
              <button
                type="button"
                onClick={() => setPrepLocked(!prepLocked)}
                className="absolute right-3 top-3 z-10 rounded-md p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                title={prepLocked ? "Unlock editing" : "Lock editing"}
              >
                {prepLocked ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
              </button>
              <div className="flex-1 min-h-0">
                <MarkdownEditor value={prepNotes} onChange={onPrepChange} readOnly={prepLocked} />
              </div>
            </div>
          ) : (
            <EmptyTabContent message="No prep notes for this meeting." />
          )}
        </TabsContent>

        {/* ---- NOTES TAB ---- */}
        <TabsContent value="notes" forceMount className={activeTabId !== "notes" ? "hidden" : ""}>
          {(isDraft || isLive) ? (
            <div className="flex-1 min-h-0 overflow-hidden rounded-md border border-[var(--border-default)] bg-white">
              <MarkdownEditor
                value={notes}
                onChange={onNotesChange}
                onBlur={() => { api.runs.writeNotes(runFolder, notes).catch(() => {}); }}
              />
            </div>
          ) : isProcessing ? (
            <div className="space-y-4">
              {pipelineStatusContent}
              {completedNotesContent.trim() ? (
                <MarkdownView source={completedNotesContent} className="markdown-view" />
              ) : (
                <EmptyTabContent message="Notes will appear after processing completes." />
              )}
            </div>
          ) : isCompletedMeeting ? (
            completedNotesContent.trim() || notesEditMode ? (
              <div className="relative flex min-h-0 flex-1 flex-col rounded-md border border-[var(--border-default)] bg-white">
                <button
                  type="button"
                  onClick={() => setNotesEditMode(!notesEditMode)}
                  className="absolute right-3 top-3 z-10 rounded-md p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                  title={notesEditMode ? "Lock editing" : "Unlock editing"}
                >
                  {notesEditMode ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                </button>
                <div className="flex-1 min-h-0">
                  <MarkdownEditor
                    value={completedNotesContent}
                    onChange={onNotesChange}
                    onBlur={() => { api.runs.writeNotes(runFolder, completedNotesContent).catch(() => {}); }}
                    readOnly={!notesEditMode}
                  />
                </div>
              </div>
            ) : (
              <EmptyTabContent message="No notes for this meeting." />
            )
          ) : (
            <EmptyTabContent message="No notes for this meeting." />
          )}
        </TabsContent>

        {/* ---- SUMMARY TAB ---- */}
        <TabsContent value="summary">
          {(isDraft || isLive) ? (
            <EmptyTabContent message="Summary will be generated after recording." />
          ) : isProcessing ? (
            <div className="min-h-0 space-y-4">{pipelineStatusContent}<EmptyTabContent message="Summary is being generated…" /></div>
          ) : (
            <div className="min-h-0 space-y-4">
              {pipelineStatusContent}
              {hasSummaryContent ? (
                <div className="flex-1 min-h-0 rounded-md border border-[var(--border-default)] bg-white">
                  <MarkdownEditor value={summaryContent} onChange={() => {}} readOnly />
                </div>
              ) : (
                <EmptyTabContent message="No summary has been generated yet." />
              )}
            </div>
          )}
        </TabsContent>

        {/* ---- ANALYSIS TAB ---- */}
        <TabsContent value="analysis">
          {(isDraft || isLive) ? (
            <EmptyTabContent message="Analysis will be available after processing." />
          ) : (
            <div className="flex h-[calc(100vh-var(--header-height)-10rem)] min-h-[24rem] overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-white shadow-sm">
              {/* Sidebar */}
              <div className="flex w-52 shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-secondary)]/30 lg:w-64">
                <div className="space-y-4 p-4">
                  <h2 className="text-sm font-semibold text-[var(--text-primary)]">Library</h2>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                    <Input
                      placeholder="Filter..."
                      className="h-8 bg-white/60 pl-8 text-xs focus:bg-white"
                      value={analysisSearchQuery}
                      onChange={(e) => setAnalysisSearchQuery(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto px-2 pb-4">
                  {loadingPrompts ? (
                    <div className="px-4 py-3 text-sm text-[var(--text-secondary)]"><Spinner className="h-3.5 w-3.5" /> Loading…</div>
                  ) : sortedAnalysisPrompts.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-[var(--text-secondary)]">No analysis prompts yet.</div>
                  ) : filteredAnalysisPrompts.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-[var(--text-secondary)]">No prompts match this filter.</div>
                  ) : (
                    <div className="space-y-4">
                      {analysisPreloadedPrompts.length > 0 && (
                        <div className="space-y-1 px-2">
                          <div className="px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--text-tertiary)]/70">Pre-loaded</div>
                          <div className="space-y-0.5">
                            {analysisPreloadedPrompts.map((prompt) => (
                              <AnalysisSidebarItem key={prompt.id} prompt={prompt} active={activePromptId === prompt.id} onSelect={() => setActivePromptId(prompt.id)} defaultModel={defaultModel} />
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="space-y-1 px-2">
                        <div className="px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--text-tertiary)]/70">Custom</div>
                        <div className="space-y-0.5 px-0.5">
                          {analysisCustomPrompts.length === 0 ? (
                            <div className="px-3 py-2 text-[11px] italic text-[var(--text-tertiary)]">No custom prompts yet</div>
                          ) : analysisCustomPrompts.map((prompt) => (
                            <AnalysisSidebarItem key={prompt.id} prompt={prompt} active={activePromptId === prompt.id} onSelect={() => setActivePromptId(prompt.id)} defaultModel={defaultModel} />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {/* Content */}
              <div className="min-w-0 flex-1 overflow-y-auto">
                {activePrompt ? (
                  <div className="space-y-6 p-5 md:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border-subtle)] pb-5">
                      <div className="min-w-0 space-y-2">
                        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">{activePrompt.label}</h2>
                        <p className="max-w-3xl text-sm text-[var(--text-secondary)]">
                          {activePrompt.description?.trim() || "No description yet."}
                        </p>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[var(--text-tertiary)]">
                          {formatAnalysisPromptMeta(activePrompt, defaultModel)}
                        </p>
                      </div>
                      <Button size="sm" onClick={() => void startReprocess({ runFolder, onlyIds: [activePrompt.id] })}>
                        <PlayCircle className="h-3.5 w-3.5" /> Run prompt
                      </Button>
                    </div>
                    {pipelineStatusContent}
                    {activePrompt.hasOutput ? (
                      <div className="rounded-xl border border-[var(--border-subtle)] bg-white p-5 md:p-6">
                        <MarkdownView source={promptContent} className="markdown-view" />
                      </div>
                    ) : (
                      <EmptyTabContent message="This prompt has not produced output for this meeting yet." />
                    )}
                  </div>
                ) : (
                  <div className="p-5 md:p-6">
                    {pipelineStatusContent}
                    <EmptyTabContent message="Select an analysis prompt to view its output." />
                  </div>
                )}
              </div>
            </div>
          )}
        </TabsContent>

        {/* ---- TRANSCRIPT TAB ---- */}
        <TabsContent value="transcript">
          {(isDraft || isLive) ? (
            <EmptyTabContent message="Transcript will be generated after recording." />
          ) : isProcessing ? (
            <div className="space-y-4">{pipelineStatusContent}<EmptyTabContent message="Transcript is being generated…" /></div>
          ) : hasTranscript ? (
            <TranscriptView source={transcriptContent} />
          ) : (
            <EmptyTabContent message="No transcript available for this meeting." />
          )}
        </TabsContent>

        {/* ---- RECORDING TAB ---- */}
        <TabsContent value="recording">
          {isLive ? (
            <div className="space-y-4">
              <div className="flex items-center gap-4 text-sm text-[var(--text-secondary)]">
                <AudioMeter label="Mic" active={isRecording} />
                <span>·</span>
                <span className={recording.system_captured ? "" : "text-[var(--warning-text)]"}>
                  {recording.system_captured ? "System audio capturing" : "System audio not available"}
                </span>
              </div>
              {recording.system_audio_warning && (
                <div className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-muted)] px-4 py-3 text-sm text-[var(--warning-text)]">
                  {recording.system_audio_warning}
                </div>
              )}
              {sections.length > 0 && <PipelineStatus sections={sections} title="Live processing" />}
            </div>
          ) : recordingFiles.length === 0 ? (
            <EmptyTabContent message="No recording yet." />
          ) : (
            <div className="space-y-4">
              {recordingFiles.map((file) => {
                const source = recordingSources[file.name];
                const audioPreview = isAudioRecording(file.name) && source;
                const videoRecording = isVideoRecording(file.name);
                return (
                  <div key={file.name} className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[var(--text-primary)] break-all">{file.name}</div>
                        <div className="mt-0.5 text-xs text-[var(--text-secondary)]">{getRecordingTypeLabel(file.name)} · {formatFileSize(file.size)}</div>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button variant="secondary" size="sm" onClick={() => void onDownloadRecording(file.name)}>
                          <FileOutput className="h-3.5 w-3.5" /> Download
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => setRecordingToDelete(file.name)}>
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </Button>
                      </div>
                    </div>
                    {audioPreview ? (
                      <audio controls preload="metadata" src={source} className="w-full">Your browser does not support audio playback.</audio>
                    ) : videoRecording ? (
                      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-4 text-sm text-[var(--text-secondary)]">
                        Video preview isn&apos;t available in-app yet. Download to view.
                      </div>
                    ) : (
                      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-4 text-sm text-[var(--text-secondary)]">
                        Preview is not available. Download the file to inspect it.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ---- FILES TAB ---- */}
        <TabsContent value="files">
          {attachmentsLoading ? (
            <div className="py-8 text-center text-sm text-[var(--text-secondary)]">Loading…</div>
          ) : (
            <div className="space-y-4">
              {attachments.length > 0 && (
                <div className="text-sm font-medium text-[var(--text-primary)]">
                  Attached files ({attachments.length})
                </div>
              )}
              {attachments.length > 0 && (
                <div className="space-y-1.5">
                  {attachments.map((a) => (
                    <div key={a.name} className="flex items-center justify-between rounded-lg border border-[var(--border-default)] bg-white px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-[var(--text-primary)]">{a.name}</div>
                        <div className="text-xs text-[var(--text-tertiary)]">{formatFileSize(a.size)}</div>
                      </div>
                      {!isProcessing && (
                        <Button variant="ghost" size="sm" onClick={() => onRemoveAttachment(a.name)} className="ml-2 text-[var(--text-tertiary)] hover:text-[var(--error)]">
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {!isProcessing && (
                <div
                  className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[var(--border-default)] bg-[var(--bg-secondary)]/30 px-6 py-10 text-center transition-colors hover:border-[var(--accent)]/40 hover:bg-[var(--bg-secondary)]/50 cursor-pointer"
                  onClick={onAddAttachment}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // Drag and drop handled via the native file picker for now
                    void onAddAttachment();
                  }}
                >
                  <FileUp className="h-6 w-6 text-[var(--text-tertiary)]" />
                  <div className="text-sm text-[var(--text-secondary)]">
                    Drop files here or click to browse
                  </div>
                  <div className="text-xs text-[var(--text-tertiary)]">
                    Reference documents, slides, or other materials
                  </div>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* ---- METADATA TAB ---- */}
        <TabsContent value="metadata">
          <OverviewPanel detail={detail} runFolder={runFolder} onUpdated={() => void refresh()} />
        </TabsContent>
      </Tabs>

      {config.obsidian_integration.enabled && (() => {
        const target = activeTabId === "summary" ? promptCollections.summaryFileName
          : activeTabId === "notes" ? "notes.md"
          : activeTabId === "transcript" ? "transcript.md"
          : activeTabId === "analysis" && activePrompt ? activePrompt.fileName
          : null;
        return target ? (
          <Button variant="secondary" onClick={() => void api.runs.openInObsidian(runFolder, target)}>Open in Obsidian</Button>
        ) : null;
      })()}

      </>
      )}

      {/* ---- Dialogs ---- */}
      {reprocessOpen && (
        <ReprocessModal
          runFolder={runFolder}
          hasAudio={detail ? detail.files.some((f) => f.kind === "media") : false}
          onClose={() => setReprocessOpen(false)}
          onStart={async ({ transcript, summary }) => {
            if (transcript) {
              await api.runs.startProcessRecording({ runFolder });
            } else if (summary) {
              await startReprocess({ runFolder, onlyIds: [PRIMARY_PROMPT_ID] });
            }
            setReprocessOpen(false);
          }}
        />
      )}

      {chatLauncherOpen && (
        <ChatLauncherModal
          runFolder={runFolder}
          detail={isComplete || isError ? detail : undefined}
          availableFiles={isDraft || isLive ? ["prep.md", "notes.md", ...attachments.map((a) => a.name)] : undefined}
          config={config}
          meetingStatus={effectiveStatus}
          onClose={() => setChatLauncherOpen(false)}
        />
      )}

      {/* End meeting dialog */}
      <Dialog open={endDialogOpen} onOpenChange={(open) => { if (!open && !stopping) setEndDialogOpen(false); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>End meeting</DialogTitle>
            <DialogDescription>Stop the recording and choose what happens next.</DialogDescription>
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

      {/* Delete recording dialog */}
      <Dialog open={recordingToDelete != null} onOpenChange={(open) => { if (!open && !deletingRecording) setRecordingToDelete(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete recording?</DialogTitle>
            <DialogDescription>This removes the recording from disk but keeps the meeting, notes, transcript, and analysis files.</DialogDescription>
          </DialogHeader>
          {recordingToDelete && (
            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--text-primary)] break-all">{recordingToDelete}</div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRecordingToDelete(null)} disabled={deletingRecording}>Cancel</Button>
            <Button variant="destructive" onClick={() => void onConfirmDeleteRecording()} disabled={deletingRecording}>
              {deletingRecording ? <><Spinner /> Deleting…</> : "Delete recording"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete / discard confirmation */}
      <ConfirmDialog
        open={pendingConfirm != null}
        onOpenChange={(open) => { if (!open && !confirmingAction) setPendingConfirm(null); }}
        title={pendingConfirm?.title ?? ""}
        description={pendingConfirm?.description ?? ""}
        cancelLabel={pendingConfirm?.cancelLabel}
        confirmLabel={pendingConfirm?.confirmLabel ?? "Confirm"}
        confirmingLabel={pendingConfirm?.confirmingLabel}
        confirmVariant={pendingConfirm?.confirmVariant}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => void onConfirmPendingAction()}
        disabled={confirmingAction}
      />

      {/* Delete draft confirmation */}
      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={(open) => { if (!open && !stopping) setConfirmDeleteOpen(false); }}
        title={isDraft ? "Delete draft?" : "Delete meeting?"}
        description={isDraft ? "This will permanently delete this draft workspace and all its contents." : "This will stop the recording and permanently delete everything."}
        cancelLabel={isDraft ? "Keep draft" : "Keep meeting"}
        confirmLabel={isDraft ? "Delete draft" : "Delete meeting"}
        confirmingLabel="Deleting…"
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={async () => {
          setStopMode("delete");
          try {
            deletedRef.current = true;
            if (prepSaveTimer.current != null) window.clearTimeout(prepSaveTimer.current);
            if (isLive) { await api.recording.stop({ mode: "delete" }); setNotes(""); }
            else if (isDraft) { await api.runs.deleteRun(runFolder); }
            setConfirmDeleteOpen(false);
            onBack();
          } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
          finally { setStopMode(null); }
        }}
        disabled={stopping}
      />

      {error && (
        <div className="rounded-lg border border-[var(--error)]/20 bg-[var(--error-muted)] px-4 py-3 text-sm text-[var(--error)]">{error}</div>
      )}
    </PageScaffold>
  );
}

// ---------------------------------------------------------------------------
// Analysis sidebar item
// ---------------------------------------------------------------------------

function AnalysisSidebarItem({
  prompt,
  active,
  onSelect,
  defaultModel,
}: {
  prompt: MeetingAnalysisPromptItem;
  active: boolean;
  onSelect: () => void;
  defaultModel: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group relative flex w-full items-center justify-between rounded-md px-3 py-2 text-left transition-all ${
        active
          ? "bg-white font-semibold text-[var(--text-primary)] shadow-sm ring-1 ring-black/5"
          : "text-[var(--text-secondary)] hover:bg-white/60 hover:text-[var(--text-primary)]"
      }`}
    >
      <div className="min-w-0">
        <span className="truncate text-xs">{prompt.label}</span>
        <div className="mt-0.5 truncate text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
          {formatAnalysisPromptMeta(prompt, defaultModel)}
        </div>
      </div>
      {active && <div className="absolute left-0 top-2 h-4 w-0.5 rounded-full bg-[var(--accent)]" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Reprocess modal
// ---------------------------------------------------------------------------

function ReprocessModal({
  runFolder,
  hasAudio,
  onClose,
  onStart,
}: {
  runFolder: string;
  hasAudio: boolean;
  onClose: () => void;
  onStart: (opts: { transcript: boolean; summary: boolean }) => Promise<void>;
}) {
  const [transcript, setTranscript] = useState(false);
  const [summary, setSummary] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nothingSelected = !transcript && !summary;

  const onRun = async () => {
    setError(null);
    setRunning(true);
    try {
      await onStart({ transcript, summary });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-6">
        <DialogHeader>
          <DialogTitle>Reprocess meeting</DialogTitle>
          <DialogDescription>
            Choose what to rebuild. Runs in the background. To re-run individual analysis prompts, use the Analysis tab.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="flex items-center gap-3 rounded-lg border border-[var(--border-default)] bg-white px-4 py-3 cursor-pointer transition-colors hover:bg-[var(--bg-secondary)]/30">
            <Checkbox
              checked={transcript}
              onCheckedChange={(v) => setTranscript(v === true)}
              disabled={!hasAudio}
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-[var(--text-primary)]">Rebuild transcript</div>
              <div className="text-xs text-[var(--text-secondary)]">
                {hasAudio
                  ? "Re-transcribe from audio files. Also regenerates the summary."
                  : "No audio files available for this meeting."}
              </div>
            </div>
          </label>

          <label className="flex items-center gap-3 rounded-lg border border-[var(--border-default)] bg-white px-4 py-3 cursor-pointer transition-colors hover:bg-[var(--bg-secondary)]/30">
            <Checkbox
              checked={summary || transcript}
              onCheckedChange={(v) => setSummary(v === true)}
              disabled={transcript}
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-[var(--text-primary)]">Regenerate summary</div>
              <div className="text-xs text-[var(--text-secondary)]">
                Re-run the primary summary prompt using the existing transcript.
              </div>
            </div>
          </label>

          {error ? <div className="text-sm text-[var(--error)]">{error}</div> : null}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={running}>
            Cancel
          </Button>
          <Button
            onClick={onRun}
            disabled={running || nothingSelected}
            className="min-w-[120px]"
          >
            {running ? (
              <>
                <Spinner />
                Starting…
              </>
            ) : (
              "Reprocess"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
