import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CirclePlay,
  ExternalLink,
  FileText,
  MoreHorizontal,
  NotebookPen,
  Pause,
  Play,
  PlayCircle,
  RefreshCcw,
  Square,
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
} from "../../../shared/ipc";
import {
  buildMeetingPromptCollections,
  PRIMARY_PROMPT_ID,
  type MeetingAnalysisPromptItem,
} from "../../../shared/meeting-prompts";
import { ChatLauncherModal } from "../components/ChatLauncherModal";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EditableTitle } from "../components/EditableTitle";
import {
  InlineScheduledTime,
  StatusLine,
} from "../components/meeting-header-parts";
import {
  PipelineStatus,
  applyProgress,
  CancelJobButton,
  outputsFromJobSteps,
  type PromptOutputStatus,
} from "../components/PipelineStatus";
import { Badge } from "../components/ui/badge";
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
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group";
import { Spinner } from "../components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { getDefaultPromptModel, getPromptModelSummary } from "../lib/prompt-metadata";
import { MeetingDetailsView, type DetailsTabKind } from "./MeetingDetailsView";
import { PlaybackProvider } from "../components/MeetingAudioPlayer";
import { MeetingWorkspaceView } from "./MeetingWorkspaceView";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MeetingView = "workspace" | "details";

interface MeetingShellProps {
  runFolder: string;
  /** Initial segmented-control state. If omitted, derived from meeting status. */
  initialView?: MeetingView;
  recording: RecordingStatus;
  config: AppConfigDTO;
  onBack: () => void;
  onOpenMeeting: (runFolder: string) => void;
  onOpenPromptLibrary: (promptId?: string) => void;
  /** Notifies the router when the user flips the Workspace/Details toggle. */
  onViewChange?: (view: MeetingView, opts?: { replace?: boolean }) => void;
  onDirtyChange?: (isDirty: boolean) => void;
}

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

function formatModelNote(
  prompt: Pick<PromptRow, "model"> | null | undefined,
  defaultModel: string | null,
) {
  const model = getPromptModelSummary(prompt, defaultModel);
  if (!model.id) return "Model unavailable";
  const displayLabel = model.rawId ?? model.label;
  if (model.providerLabel === "Local model") return `Uses local model ${displayLabel}`;
  return `Uses ${model.label}`;
}

function sortAnalysisPrompts(left: MeetingAnalysisPromptItem, right: MeetingAnalysisPromptItem) {
  if (
    left.prompt.sort_order != null &&
    right.prompt.sort_order != null &&
    left.prompt.sort_order !== right.prompt.sort_order
  ) {
    return left.prompt.sort_order - right.prompt.sort_order;
  }
  if (left.prompt.sort_order != null && right.prompt.sort_order == null) return -1;
  if (left.prompt.sort_order == null && right.prompt.sort_order != null) return 1;
  return left.label.localeCompare(right.label);
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
// MeetingShell — owns all meeting data; renders shell header + view dispatch.
// ---------------------------------------------------------------------------

export function MeetingShell({
  runFolder,
  initialView,
  recording,
  config,
  onBack,
  onOpenMeeting,
  onOpenPromptLibrary: _onOpenPromptLibrary,
  onViewChange,
  onDirtyChange,
}: MeetingShellProps) {
  // ---- Core state ----
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- View state ----
  const [view, setView] = useState<MeetingView>(initialView ?? "workspace");
  const viewResolvedRef = useRef(initialView !== undefined);

  // ---- Tab state (Details view) ----
  const [activeTabId, setActiveTabId] = useState<DetailsTabKind>("metadata");
  const [tabContents, setTabContents] = useState<Record<string, string>>({});
  const [documentReloadVersion, setDocumentReloadVersion] = useState(0);

  // ---- Prep / Notes state (Workspace view) ----
  const [prepNotes, setPrepNotes] = useState("");
  const [notes, setNotes] = useState("");
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

  // ---- Dialog state ----
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [chatLauncherOpen, setChatLauncherOpen] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmState | null>(null);
  const [confirmingAction, setConfirmingAction] = useState(false);

  const detailSignatureRef = useRef("");
  const deletedRef = useRef(false);

  // ---- Derived state ----
  const isRecordingThis = recording.active && recording.run_folder === runFolder;
  const isDraft = detail?.status === "draft" && !isRecordingThis;
  const isRecording = isRecordingThis && !recording.paused;
  const isPaused =
    (isRecordingThis && !!recording.paused) || (!isRecordingThis && detail?.status === "paused");
  const isProcessing = detail?.status === "processing";
  const isComplete = detail?.status === "complete";
  const isError = detail?.status === "error";
  const isLive = isRecording || isPaused;
  const stopping = stopMode !== null;

  const wasCompleted = useMemo(() => {
    if (!isDraft || !detail) return false;
    const manifestSections = detail.manifest?.prompt_outputs ?? {};
    return Object.values(manifestSections).some((s) => s?.status === "complete");
  }, [isDraft, detail]);

  const effectiveStatus = isRecording
    ? "recording"
    : isPaused
    ? "paused"
    : detail?.status ?? "draft";

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
        if (key === "summary" || key.startsWith("prompt:")) {
          changed = true;
          continue;
        }
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
    setRecordingSources({});
    setRecordingToDelete(null);
    setDeletingRecording(false);
    detailSignatureRef.current = "";
    initialNotesRef.current = null;
    viewResolvedRef.current = initialView !== undefined;
    if (initialView) setView(initialView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runFolder]);

  // Default-view resolution: once detail first loads, if the hash didn't
  // specify a view, pick Workspace for editable/live states (draft, paused,
  // active recording) and Details for everything else. Sync back to the
  // router so the hash reflects the choice.
  useEffect(() => {
    if (!detail) return;
    if (viewResolvedRef.current) return;
    // Always default to Workspace on first load — users almost always want to
    // read/edit prep + notes first, and can flip to Details via the header tabs.
    const next: MeetingView = "workspace";
    viewResolvedRef.current = true;
    if (next !== view) setView(next);
    // Replace the current history entry rather than pushing — otherwise the
    // initial /meeting/:folder entry and the resolved /meeting/:folder/workspace
    // entry both sit on the stack, and the first Back click is a silent no-op.
    onViewChange?.(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, runFolder]);

  // ---- Load prep + notes ----
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const prep = await api.runs.readPrep(runFolder);
        if (!cancelled) setPrepNotes(prep);
        const n = await api.runs.readDocument(runFolder, "notes.md").catch(() => "");
        if (!cancelled) {
          setNotes(n);
          initialNotesRef.current = n;
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runFolder]);

  // ---- Load attachments ----
  useEffect(() => {
    setAttachmentsLoading(true);
    api.runs
      .listAttachments(runFolder)
      .then(setAttachments)
      .catch(() => setAttachments([]))
      .finally(() => setAttachmentsLoading(false));
  }, [runFolder]);

  // ---- Load prompts ----
  useEffect(() => {
    let alive = true;
    setLoadingPrompts(true);
    void api.prompts
      .list()
      .then((list) => {
        if (alive) setPrompts(list);
      })
      .catch(() => {
        if (alive) setPrompts([]);
      })
      .finally(() => {
        if (alive) setLoadingPrompts(false);
      });
    return () => {
      alive = false;
    };
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
    api.jobs
      .list()
      .then((allJobs) => {
        if (canceled) return;
        setActiveJob(
          allJobs.find(
            (job) => job.runFolder === runFolder && (job.status === "queued" || job.status === "running"),
          ) ?? null,
        );
      })
      .catch(() => {});
    const unsub = api.on.jobUpdate((job) => {
      if (job.runFolder !== runFolder) return;
      if (job.status === "queued" || job.status === "running") {
        setActiveJob(job);
        return;
      }
      setActiveJob((current) => (current?.id === job.id ? null : current));
    });
    return () => {
      canceled = true;
      unsub();
    };
  }, [runFolder]);

  useEffect(() => {
    if (!activeJob?.progress.steps?.length) return;
    setSections(outputsFromJobSteps(activeJob.progress.steps));
  }, [activeJob]);

  // Poll for updates when processing
  useEffect(() => {
    if (!detail || detail.status !== "processing") return;
    const id = setInterval(() => {
      void refresh();
    }, 7000);
    return () => clearInterval(id);
  }, [detail?.status, runFolder]);

  // Elapsed-timer display lives in the global SiteHeader pill so it persists
  // across routes; the meeting header no longer re-renders it.

  // Reset recording-dialog state + refresh detail when the recording ends
  const prevRecordingRef = useRef(isRecordingThis);
  useEffect(() => {
    if (!isRecordingThis) {
      setEndDialogOpen(false);
      setConfirmDeleteOpen(false);
      setEndMode("process");
      setSelectedProcessStepIds([]);
    }
    if (prevRecordingRef.current && !isRecordingThis && !deletedRef.current) {
      void refresh();
    }
    prevRecordingRef.current = isRecordingThis;
  }, [isRecordingThis]);

  // ---- Analysis computations ----
  const defaultModel = useMemo(() => getDefaultPromptModel(config), [config]);

  const promptCollections = useMemo(() => {
    if (!detail)
      return {
        primaryPrompt: null,
        summaryFileName: "summary.md",
        summaryStatus: undefined,
        summaryHasOutput: false,
        analysisPrompts: [] as MeetingAnalysisPromptItem[],
      };
    const manifest = (detail.manifest ?? {}) as {
      sections?: Record<string, { filename?: string; label?: string; status?: string }>;
    };
    return buildMeetingPromptCollections({
      prompts,
      manifestOutputs: manifest.prompt_outputs ?? {},
      files: detail.files.filter(
        (f): f is typeof f & { kind?: "document" | "log" | "media" } => f.kind !== "attachment",
      ),
    });
  }, [detail, prompts]);

  const sortedAnalysisPrompts = useMemo(
    () => [...promptCollections.analysisPrompts].sort(sortAnalysisPrompts),
    [promptCollections.analysisPrompts],
  );
  const filteredAnalysisPrompts = useMemo(() => {
    const query = analysisSearchQuery.trim().toLowerCase();
    if (!query) return sortedAnalysisPrompts;
    return sortedAnalysisPrompts.filter(
      (p) =>
        p.label.toLowerCase().includes(query) ||
        p.id.toLowerCase().includes(query) ||
        (p.description?.toLowerCase().includes(query) ?? false),
    );
  }, [analysisSearchQuery, sortedAnalysisPrompts]);
  const analysisPreloadedPrompts = useMemo(
    () => filteredAnalysisPrompts.filter((p) => p.prompt.builtin),
    [filteredAnalysisPrompts],
  );
  const analysisCustomPrompts = useMemo(
    () => filteredAnalysisPrompts.filter((p) => !p.prompt.builtin),
    [filteredAnalysisPrompts],
  );

  useEffect(() => {
    if (activePromptId && sortedAnalysisPrompts.some((p) => p.id === activePromptId)) return;
    const firstComplete =
      sortedAnalysisPrompts.find((p) => p.status === "complete" && p.hasOutput) ?? sortedAnalysisPrompts[0];
    setActivePromptId(firstComplete?.id ?? null);
  }, [activePromptId, sortedAnalysisPrompts]);

  const recordingFiles = useMemo(() => (detail ? detail.files.filter((f) => f.kind === "media") : []), [detail]);

  // Combined playback file drives click-to-seek from the transcript. We
  // require an exact `combined.wav` match (not a fallback) — transcript
  // timestamps are aligned to that specific file; any other recording has
  // different offsets and mis-seeking would be misleading. See
  // engine/process-run.ts writeCombinedPlayback.
  const combinedAudioFileName = useMemo(() => {
    const match = recordingFiles.find((f) => {
      const base = f.name.split("/").pop() ?? f.name;
      return base === "combined.wav";
    });
    return match?.name ?? null;
  }, [recordingFiles]);

  // ---- Process steps (for end-meeting dialog) ----
  const processSteps = useMemo<ProcessStep[]>(() => {
    const summaryPrompt = prompts.find((p) => p.id === PRIMARY_PROMPT_ID) ?? null;
    const autoPrompts = prompts.filter((p) => p.id !== PRIMARY_PROMPT_ID && p.enabled && p.auto);
    return [
      { id: TRANSCRIPT_STEP_ID, label: "Transcribe", description: "Create transcript from the recording.", modelNote: null },
      {
        id: PRIMARY_PROMPT_ID,
        label: summaryPrompt?.label ?? "Summary",
        description: summaryPrompt?.description ?? "Generate meeting summary.",
        modelNote: formatModelNote(summaryPrompt, defaultModel),
        promptId: PRIMARY_PROMPT_ID,
      },
      ...autoPrompts.map((p) => ({
        id: p.id,
        label: p.label,
        description: p.description,
        modelNote: formatModelNote(p, defaultModel),
        promptId: p.id,
      })),
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
        } catch {
          return null;
        }
      }),
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
    return () => {
      canceled = true;
    };
  }, [activeTabId, recordingFiles, recordingSources, runFolder]);

  // ---- Load tab content (summary, analysis output, transcript) ----
  useEffect(() => {
    if (!detail) return;
    let filePath: string | null = null;
    let cacheKey: string | null = null;
    if (activeTabId === "summary") {
      filePath = promptCollections.summaryFileName;
      cacheKey = "summary";
    } else if (activeTabId === "transcript") {
      filePath = "transcript.md";
      cacheKey = "transcript";
    } else if (activeTabId === "analysis" && activePromptId) {
      const ap = promptCollections.analysisPrompts.find((p) => p.id === activePromptId);
      if (ap) {
        filePath = ap.fileName;
        cacheKey = `prompt:${ap.id}`;
      }
    }
    if (!filePath || !cacheKey || tabContents[cacheKey] != null) return;
    api.runs
      .readDocument(runFolder, filePath)
      .then((content) => {
        setTabContents((prev) => ({ ...prev, [cacheKey!]: content }));
      })
      .catch((err) => {
        if (err instanceof Error && /ENOENT/i.test(err.message)) return;
        setTabContents((prev) => ({ ...prev, [cacheKey!]: "_(unable to load file)_" }));
      });
  }, [
    activePromptId,
    activeTabId,
    detail,
    documentReloadVersion,
    promptCollections.analysisPrompts,
    promptCollections.summaryFileName,
    runFolder,
    tabContents,
  ]);

  // ---- Dirty state ----
  // Notes are always inline-editable now; dirty = in-memory buffer differs
  // from what was loaded from disk. initialNotesRef is populated by the load
  // effect so the first render after mount is never dirty.
  const isCompletedMeeting =
    detail != null && !["draft", "recording", "processing"].includes(detail.status);
  const isNotesDirty =
    isCompletedMeeting && initialNotesRef.current != null && notes !== initialNotesRef.current;

  useEffect(() => {
    onDirtyChange?.(isNotesDirty);
  }, [isNotesDirty, onDirtyChange]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isNotesDirty) {
        e.preventDefault();
        e.returnValue = "unsaved";
        return e.returnValue;
      }
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
    try {
      await api.recording.pause();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onResume = async () => {
    try {
      if (isRecordingThis) await api.recording.resume();
      else await api.recording.continueRecording({ runFolder });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
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

  const startReprocess = async (request: ReprocessRequest) => {
    await api.runs.startReprocess(request);
    setSections([]);
    setPipelineError(null);
    setReprocessStarting(true);
    void refresh();
  };

  const onDelete = () => {
    setPendingConfirm({
      title: isDraft ? "Delete draft?" : "Delete meeting?",
      description: isDraft
        ? "This will permanently delete this draft workspace and all its contents."
        : "This permanently deletes the meeting and all of its files from disk.",
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
    setNotes(value);
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      api.runs.writeNotes(runFolder, value).catch(() => {});
    }, 400);
  };

  const onNotesBlur = () => {
    api.runs.writeNotes(runFolder, notes).catch(() => {});
  };

  const onPrepChange = (value: string) => {
    setPrepNotes(value);
    if (prepSaveTimer.current != null) window.clearTimeout(prepSaveTimer.current);
    prepSaveTimer.current = window.setTimeout(() => {
      api.runs.writePrep(runFolder, value).catch(() => {});
    }, 400);
  };

  const requestNotesDiscard = (
    action: () => void,
    description = "You have unsaved notes. Discard your changes and continue?",
  ) => {
    if (!isNotesDirty) {
      action();
      return;
    }
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
    try {
      await pendingConfirm.action();
      setPendingConfirm(null);
    } finally {
      setConfirmingAction(false);
    }
  };

  const onTitleSave = (newTitle: string) => {
    if (!newTitle.trim()) return;
    api.runs.updateMeta({ runFolder, title: newTitle.trim() }).catch(() => {});
    setDetail((prev) => (prev ? { ...prev, title: newTitle.trim() } : prev));
  };

  const onDescriptionSave = (value: string) => {
    api.runs.updateMeta({ runFolder, description: value.trim() || null }).catch(() => {});
    setDetail((prev) => (prev ? { ...prev, description: value.trim() || null } : prev));
  };

  const onScheduledTimeChange = (iso: string | null) => {
    api.runs.updatePrep({ runFolder, scheduledTime: iso }).catch(() => {});
    setDetail((prev) => (prev ? { ...prev, scheduled_time: iso } : prev));
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
    } finally {
      setDeletingRecording(false);
    }
  };

  // ---- Computed values for views ----
  const summaryContent = tabContents.summary ?? "";
  const transcriptContent = tabContents.transcript ?? "";
  const activePrompt = activePromptId
    ? sortedAnalysisPrompts.find((p) => p.id === activePromptId) ?? null
    : null;
  const promptContent = activePromptId ? tabContents[`prompt:${activePromptId}`] ?? "" : "";

  const hasSummaryContent = promptCollections.summaryHasOutput;
  const hasTranscript = detail?.files.some((f) => f.name === "transcript.md" && f.size > 0) ?? false;

  const showPipelineStatus =
    reprocessStarting ||
    detail?.status === "processing" ||
    sections.length > 0 ||
    pipelineError != null ||
    activeJob != null;

  const pipelineStatusContent = showPipelineStatus ? (
    <div className="space-y-3">
      <PipelineStatus
        sections={sections}
        title={
          reprocessStarting && sections.length === 0 ? "Reprocess queued for this meeting" : "Processing"
        }
        description={
          pipelineError
            ? pipelineError
            : reprocessStarting && sections.length === 0
            ? "The job has started in the background."
            : activeJob?.subtitle ?? "Outputs update in place as each step finishes."
        }
        status={activeJob?.status ?? "processing"}
        queuePosition={activeJob?.queuePosition}
        currentLabel={activeJob?.progress.currentOutputLabel}
        showPreparingWhenEmpty
        action={
          activeJob?.cancelable ? (
            <CancelJobButton jobId={activeJob.id} onCancel={(jobId) => api.jobs.cancel(jobId)} />
          ) : undefined
        }
      />
      {pipelineError ? (
        <div className="flex items-start gap-3 rounded-lg border border-[color:rgba(185,28,28,0.18)] bg-[rgba(185,28,28,0.06)] px-4 py-3 text-sm text-[var(--error)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>{pipelineError}</div>
        </div>
      ) : null}
    </div>
  ) : null;

  // ---- View toggle — no discard guard, both views share shell state ----
  const setViewSafely = (next: MeetingView) => {
    if (next === view) return;
    setView(next);
    onViewChange?.(next);
  };

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
      <div className="rounded-lg border border-[var(--error)]/20 bg-[var(--error-muted)] px-4 py-3 text-sm text-[var(--error)]">
        {error}
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="rounded-lg border border-[var(--border-default)] bg-white px-4 py-4 text-sm text-[var(--text-secondary)]">
        Meeting not found.
      </div>
    );
  }

  // ---- Recording controls (right column of shell header) ----
  const recordingControls = (() => {
    if (isRecording || isPaused) {
      return (
        <div className="flex items-center gap-2">
          {isPaused && !isRecording && (
            <Badge variant="warning" className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider">
              Paused
            </Badge>
          )}
          <div className="flex items-center rounded-md border border-[var(--border-subtle)] bg-white shadow-sm overflow-hidden">
            {isPaused ? (
              <Button variant="ghost" size="sm" onClick={onResume} className="h-8 rounded-none border-r border-[var(--border-subtle)] px-3 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]" title="Resume recording">
                <Play className="h-4 w-4" />
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={onPause} className="h-8 rounded-none border-r border-[var(--border-subtle)] px-3 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]" title="Pause recording">
                <Pause className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                resetEndMeetingState();
                setEndDialogOpen(true);
              }}
              disabled={stopping}
              className="h-8 rounded-none px-3 text-[var(--error)] hover:bg-[var(--error-muted)] hover:text-[var(--error)]"
              title="End meeting"
            >
              <Square className="h-4 w-4" />
            </Button>
          </div>
        </div>
      );
    }
    if (isDraft) {
      return (
        <>
          <Button onClick={onStart} size="sm">
            <CirclePlay className="h-3.5 w-3.5" /> Start recording
          </Button>
          {wasCompleted && (
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                try {
                  await api.runs.markComplete(runFolder);
                  await refresh();
                } catch (err) {
                  console.error("Mark complete failed", err);
                }
              }}
            >
              Mark complete
            </Button>
          )}
        </>
      );
    }
    if (isComplete) {
      return (
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            try {
              await api.recording.continueRecording({ runFolder });
            } catch (err) {
              console.error("Continue recording failed", err);
            }
          }}
        >
          <PlayCircle className="h-3.5 w-3.5" /> Continue recording
        </Button>
      );
    }
    if (isError) {
      return (
        <Button size="sm" onClick={() => setReprocessOpen(true)}>
          <RefreshCcw className="h-3.5 w-3.5" /> Reprocess
        </Button>
      );
    }
    return null;
  })();

  const overflowMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => setChatLauncherOpen(true)}>
          <ExternalLink className="h-3.5 w-3.5" /> Launch chat
        </DropdownMenuItem>
        {(isComplete || isError) && (
          <DropdownMenuItem onSelect={() => setReprocessOpen(true)}>Reprocess</DropdownMenuItem>
        )}
        {(isComplete || isError) && (
          <DropdownMenuItem
            onSelect={async () => {
              try {
                await api.runs.reopenAsDraft(runFolder);
                await refresh();
              } catch (err) {
                console.error("Reopen as draft failed", err);
              }
            }}
          >
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
  );

  // ---- Shell layout (Flexbox, not calc-inside-views) ----

  return (
    <div className="flex h-[calc(100vh-var(--header-height))] flex-col overflow-hidden">
      {/* Three-column shell header */}
      <header className="flex shrink-0 flex-col gap-2 border-b border-[var(--border-subtle)] bg-white px-4 py-2 md:px-6">
        {/*
          Header is a single flex row: title grows, right toolbar clusters
          view-tabs + recording controls + ⋯. At narrow widths the tabs wrap
          to their own row (still right-aligned via order-last).
        */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* Left: title + status chip (tooltip trigger) */}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {isProcessing ? (
              <h2
                className="truncate text-base font-semibold text-[var(--text-primary)] md:text-lg"
                title={detail.title}
              >
                {detail.title}
              </h2>
            ) : (
              <EditableTitle value={detail.title} onSave={onTitleSave} />
            )}
            <TooltipProvider delayDuration={120}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Meeting status details"
                    className="shrink-0 cursor-default rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  >
                    <StatusLine status={effectiveStatus} duration={detail.duration_minutes} />
                  </button>
                </TooltipTrigger>
                <TooltipContent align="start" className="flex flex-col gap-1.5 max-w-xs">
                  {isDraft ? (
                    <InlineScheduledTime
                      value={detail.scheduled_time ?? null}
                      onChange={onScheduledTimeChange}
                    />
                  ) : (detail.started || detail.date) ? (
                    <>
                      <span className="text-[var(--text-secondary)]">
                        Started {new Date(detail.started ?? detail.date).toLocaleString()}
                      </span>
                      {detail.ended && (
                        <span className="text-[var(--text-secondary)]">
                          Ended {new Date(detail.ended).toLocaleString()}
                        </span>
                      )}
                    </>
                  ) : null}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          {/* Right toolbar: view tabs, a divider, then recording controls + ⋯ */}
          <div className="flex shrink-0 items-center gap-3">
            <Tabs
              value={view}
              onValueChange={(v) => {
                if (v === "workspace" || v === "details") setViewSafely(v);
              }}
              aria-label="Meeting view"
            >
              <TabsList className="w-auto gap-0.5 rounded-lg border-0 bg-[var(--bg-secondary)] p-0.5">
                <TabsTrigger
                  value="workspace"
                  className="gap-1.5 rounded-md border-0 px-3 py-1 text-xs -mb-0 data-[state=active]:bg-white data-[state=active]:text-[var(--text-primary)] data-[state=active]:shadow-sm"
                >
                  <NotebookPen className="h-3.5 w-3.5" />
                  Workspace
                </TabsTrigger>
                <TabsTrigger
                  value="details"
                  className="gap-1.5 rounded-md border-0 px-3 py-1 text-xs -mb-0 data-[state=active]:bg-white data-[state=active]:text-[var(--text-primary)] data-[state=active]:shadow-sm"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Details
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div aria-hidden className="h-5 w-px bg-[var(--border-subtle)]" />
            <div className="flex items-center gap-2">
              {recordingControls}
              {overflowMenu}
            </div>
          </div>
        </div>
      </header>

      {/* Failed-outputs banner — shell-level so it shows in both views. */}
      {detail.status === "error" &&
        !showPipelineStatus &&
        (() => {
          const failedOutputs = Object.entries(detail.manifest?.prompt_outputs ?? {})
            .filter(([, output]) => output?.status === "failed" && output.error)
            .map(([id, output]) => ({ id, label: output.label ?? id, error: output.error! }));
          if (failedOutputs.length === 0) return null;
          return (
            <div className="mx-4 mt-3 flex items-start gap-3 rounded-lg border border-[color:rgba(185,28,28,0.18)] bg-[rgba(185,28,28,0.06)] px-4 py-3 text-sm text-[var(--error)] md:mx-6">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-1">
                {failedOutputs.map(({ id, label, error: msg }) => (
                  <div key={id}>
                    <span className="font-medium">{label}</span> failed: {msg}
                  </div>
                ))}
                <div className="mt-2 text-xs text-[var(--text-secondary)]">
                  Use Reprocess to retry the failed step(s).
                </div>
              </div>
            </div>
          );
        })()}

      {/* View container — flex-1 gives children a real height so Analysis can
          use h-full instead of calc-against-viewport. Wrapped in
          PlaybackProvider so the transcript + summary tabs can reach into
          the shared combined-audio player; the pocket player is hidden on
          the Recording tab because it renders its own inline player for
          combined.wav. */}
      <PlaybackProvider
        runFolder={runFolder}
        combinedAudioFileName={combinedAudioFileName}
      >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4 md:p-6">
        {view === "workspace" ? (
          <MeetingWorkspaceView
            prepNotes={prepNotes}
            onPrepChange={onPrepChange}
            notes={notes}
            onNotesChange={onNotesChange}
            onNotesBlur={onNotesBlur}
            isLive={isLive}
            isRecording={isRecording}
            recording={recording}
            sections={sections}
          />
        ) : (
          <MeetingDetailsView
            detail={detail}
            runFolder={runFolder}
            config={config}
            prepNotes={prepNotes}
            notes={notes}
            activeTabId={activeTabId}
            onTabChange={(tab) => requestNotesDiscard(() => setActiveTabId(tab))}
            onFlipToWorkspace={() => setViewSafely("workspace")}
            onRefreshDetail={() => void refresh()}
            summaryContent={summaryContent}
            transcriptContent={transcriptContent}
            promptContent={promptContent}
            hasSummaryContent={hasSummaryContent}
            hasTranscript={hasTranscript}
            isDraft={isDraft}
            isLive={isLive}
            isRecording={isRecording}
            isProcessing={!!isProcessing}
            isComplete={!!isComplete}
            isError={!!isError}
            sections={sections}
            pipelineStatusContent={pipelineStatusContent}
            recording={recording}
            loadingPrompts={loadingPrompts}
            analysisSearchQuery={analysisSearchQuery}
            onAnalysisSearchChange={setAnalysisSearchQuery}
            sortedAnalysisPrompts={sortedAnalysisPrompts}
            filteredAnalysisPrompts={filteredAnalysisPrompts}
            analysisPreloadedPrompts={analysisPreloadedPrompts}
            analysisCustomPrompts={analysisCustomPrompts}
            activePromptId={activePromptId}
            onActivePromptChange={setActivePromptId}
            activePrompt={activePrompt}
            defaultModel={defaultModel}
            onRunPrompt={(id) => void startReprocess({ runFolder, onlyIds: [id] })}
            recordingFiles={recordingFiles}
            recordingSources={recordingSources}
            onRequestDeleteRecording={setRecordingToDelete}
            onDownloadRecording={(name) => void onDownloadRecording(name)}
            attachments={attachments}
            attachmentsLoading={attachmentsLoading}
            onAddAttachment={() => void onAddAttachment()}
            onRemoveAttachment={(name) => void onRemoveAttachment(name)}
            summaryFileName={promptCollections.summaryFileName}
            combinedAudioFileName={combinedAudioFileName}
          />
        )}
      </div>
      </PlaybackProvider>

      {/* ---- Dialogs ---- */}
      {reprocessOpen && (
        <ReprocessModal
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
          availableFiles={
            isDraft || isLive ? ["prep.md", "notes.md", ...attachments.map((a) => a.name)] : undefined
          }
          config={config}
          meetingStatus={effectiveStatus}
          onClose={() => setChatLauncherOpen(false)}
        />
      )}

      <Dialog
        open={endDialogOpen}
        onOpenChange={(open) => {
          if (!open && !stopping) setEndDialogOpen(false);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>End meeting</DialogTitle>
            <DialogDescription>Stop the recording and choose what happens next.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <RadioGroup className="gap-3">
              <RadioGroupItem
                id="end-process"
                name="end-mode"
                checked={endMode === "process"}
                onChange={() => setEndMode("process")}
                label="Process meeting"
                description="Transcribe and run selected output steps."
              />
              <RadioGroupItem
                id="end-save"
                name="end-mode"
                checked={endMode === "save"}
                onChange={() => setEndMode("save")}
                label="Save without processing"
                description="Keep the recording for later."
              />
              <RadioGroupItem
                id="end-delete"
                name="end-mode"
                checked={endMode === "delete"}
                onChange={() => setEndMode("delete")}
                label="Delete meeting"
                description="Discard everything."
              />
            </RadioGroup>
            {endMode === "process" && (
              <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)]/50 p-4">
                <div className="text-sm font-medium text-[var(--text-primary)]">Processing steps</div>
                <div className="mt-3 space-y-2">
                  {processSteps.map((step) => {
                    const checked = selectedStepSet.has(step.id);
                    const disabled = step.id !== TRANSCRIPT_STEP_ID && !transcriptSelected;
                    return (
                      <label
                        key={step.id}
                        className="flex items-start gap-3 rounded-md border border-[var(--border-default)] bg-white px-3 py-2.5"
                      >
                        <Checkbox
                          checked={checked}
                          disabled={disabled}
                          onCheckedChange={(next) => {
                            const isChecked = next === true;
                            setSelectedProcessStepIds((prev) => {
                              if (step.id === TRANSCRIPT_STEP_ID) return isChecked ? [TRANSCRIPT_STEP_ID] : [];
                              if (!prev.includes(TRANSCRIPT_STEP_ID)) return prev;
                              return isChecked
                                ? prev.includes(step.id)
                                  ? prev
                                  : [...prev, step.id]
                                : prev.filter((id) => id !== step.id);
                            });
                          }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-[var(--text-primary)]">
                            {step.label}
                          </span>
                          {step.modelNote && (
                            <span className="mt-0.5 block text-xs text-[var(--text-tertiary)]">
                              {step.modelNote}
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setEndDialogOpen(false)} disabled={stopping}>
              Keep recording
            </Button>
            <Button
              variant={endMode === "delete" ? "destructive" : "default"}
              onClick={() => void onConfirmEndMeeting()}
              disabled={stopping || processConfirmDisabled}
            >
              {stopping ? (
                <>
                  <Spinner /> Saving…
                </>
              ) : endMode === "process" ? (
                "End meeting"
              ) : endMode === "save" ? (
                "Save meeting"
              ) : (
                "Review delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={recordingToDelete != null}
        onOpenChange={(open) => {
          if (!open && !deletingRecording) setRecordingToDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete recording?</DialogTitle>
            <DialogDescription>
              This removes the recording from disk but keeps the meeting, notes, transcript, and analysis files.
            </DialogDescription>
          </DialogHeader>
          {recordingToDelete && (
            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--text-primary)] break-all">
              {recordingToDelete}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setRecordingToDelete(null)}
              disabled={deletingRecording}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void onConfirmDeleteRecording()}
              disabled={deletingRecording}
            >
              {deletingRecording ? (
                <>
                  <Spinner /> Deleting…
                </>
              ) : (
                "Delete recording"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingConfirm != null}
        onOpenChange={(open) => {
          if (!open && !confirmingAction) setPendingConfirm(null);
        }}
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

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={(open) => {
          if (!open && !stopping) setConfirmDeleteOpen(false);
        }}
        title={isDraft ? "Delete draft?" : "Delete meeting?"}
        description={
          isDraft
            ? "This will permanently delete this draft workspace and all its contents."
            : "This will stop the recording and permanently delete everything."
        }
        cancelLabel={isDraft ? "Keep draft" : "Keep meeting"}
        confirmLabel={isDraft ? "Delete draft" : "Delete meeting"}
        confirmingLabel="Deleting…"
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={async () => {
          setStopMode("delete");
          try {
            deletedRef.current = true;
            if (prepSaveTimer.current != null) window.clearTimeout(prepSaveTimer.current);
            if (isLive) {
              await api.recording.stop({ mode: "delete" });
              setNotes("");
            } else if (isDraft) {
              await api.runs.deleteRun(runFolder);
            }
            setConfirmDeleteOpen(false);
            onBack();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setStopMode(null);
          }
        }}
        disabled={stopping}
      />

      {error && (
        <div className="mx-4 mb-3 rounded-lg border border-[var(--error)]/20 bg-[var(--error-muted)] px-4 py-3 text-sm text-[var(--error)] md:mx-6">
          {error}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reprocess modal (kept here since it's tightly coupled to shell state)
// ---------------------------------------------------------------------------

function ReprocessModal({
  hasAudio,
  onClose,
  onStart,
}: {
  hasAudio: boolean;
  onClose: () => void;
  onStart: (opts: { transcript: boolean; summary: boolean }) => Promise<void>;
}) {
  const [transcript, setTranscript] = useState(false);
  const [summary, setSummary] = useState(true);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const nothingSelected = !transcript && !summary;

  const onRun = async () => {
    setErr(null);
    setRunning(true);
    try {
      await onStart({ transcript, summary });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
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
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--border-default)] bg-white px-4 py-3 transition-colors hover:bg-[var(--bg-secondary)]/30">
            <Checkbox checked={transcript} onCheckedChange={(v) => setTranscript(v === true)} disabled={!hasAudio} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-[var(--text-primary)]">Rebuild transcript</div>
              <div className="text-xs text-[var(--text-secondary)]">
                {hasAudio
                  ? "Re-transcribe from audio files. Also regenerates the summary."
                  : "No audio files available for this meeting."}
              </div>
            </div>
          </label>

          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--border-default)] bg-white px-4 py-3 transition-colors hover:bg-[var(--bg-secondary)]/30">
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

          {err ? <div className="text-sm text-[var(--error)]">{err}</div> : null}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={running}>
            Cancel
          </Button>
          <Button onClick={onRun} disabled={running || nothingSelected} className="min-w-[120px]">
            {running ? (
              <>
                <Spinner /> Starting…
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
