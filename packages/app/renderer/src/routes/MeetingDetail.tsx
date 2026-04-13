import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ExternalLink,
  FileOutput,
  MoreHorizontal,
  PlayCircle,
  RefreshCcw,
  Search,
  SquarePen,
  Trash2,
  AlertCircle,
} from "lucide-react";
import { api } from "../ipc-client";
import type {
  AppConfigDTO,
  JobSummary,
  PipelineProgressEvent,
  PromptRow,
  ReprocessRequest,
  RunDetail,
  RunManifest,
} from "../../../shared/ipc";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { MarkdownView } from "../components/MarkdownView";
import { OverviewPanel } from "../components/OverviewPanel";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MeetingHeader } from "../components/MeetingHeader";
import {
  PipelineStatus,
  applyProgress,
  CancelJobButton,
  outputsFromJobSteps,
  type PromptOutputStatus,
} from "../components/PipelineStatus";
import { TranscriptView } from "../components/TranscriptView";
import { ChatLauncherModal } from "../components/ChatLauncherModal";
import { PageScaffold } from "../components/PageScaffold";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Checkbox } from "../components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Spinner } from "../components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import {
  buildMeetingPromptCollections,
  PRIMARY_PROMPT_ID,
  type MeetingAnalysisPromptItem,
} from "../../../shared/meeting-prompts";
import { findModelEntry } from "../../../shared/llm-catalog";
import { getDefaultPromptModel } from "../lib/prompt-metadata";
import { getDefaultPromptModel } from "../lib/prompt-metadata";
import { findModelEntry } from "../../../shared/llm-catalog";

interface MeetingDetailProps {
  runFolder: string;
  config: AppConfigDTO;
  onBack: () => void;
  onOpenPromptLibrary: (promptId?: string) => void;
  onOpenPrep?: (runFolder: string) => void;
  onDirtyChange?: (isDirty: boolean) => void;
}

type TabKind = "summary" | "analysis" | "notes" | "transcript" | "recording" | "files" | "metadata";

type PendingConfirmState = {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  confirmingLabel?: string;
  confirmVariant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  action: () => Promise<void> | void;
};

function buildAnalysisSignature(detail: RunDetail | null): string {
  if (!detail) return "";
  const manifestOutputs = Object.entries(detail.manifest?.prompt_outputs ?? {})
    .map(([id, section]) => [
      id,
      section?.status ?? "",
      section?.filename ?? "",
    ])
    .sort(([left], [right]) => (left as string).localeCompare(right as string));
  const files = detail.files
    .filter((file) => file.kind === "document" && file.name.endsWith(".md"))
    .map((file) => [file.name, file.size] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify({ status: detail.status, manifestOutputs, files });
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

export function MeetingDetail({
  runFolder,
  config,
  onBack,
  onOpenPromptLibrary,
  onOpenPrep,
  onDirtyChange,
}: MeetingDetailProps) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTabId, setActiveTabId] = useState<TabKind>("summary");
  const [tabContents, setTabContents] = useState<Record<string, string>>({});
  const [activePromptId, setActivePromptId] = useState<string | null>(null);
  const [analysisSearchQuery, setAnalysisSearchQuery] = useState("");
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [loadingPrompts, setLoadingPrompts] = useState(true);
  const [reprocessOpen, setReprocessOpen] = useState(false);
  const [chatLauncherOpen, setChatLauncherOpen] = useState(false);
  const [sections, setSections] = useState<PromptOutputStatus[]>([]);
  const [activeJob, setActiveJob] = useState<JobSummary | null>(null);
  const [reprocessStarting, setReprocessStarting] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [notesEditMode, setNotesEditMode] = useState(false);
  const [documentReloadVersion, setDocumentReloadVersion] = useState(0);
  const [recordingSources, setRecordingSources] = useState<Record<string, string>>({});
  const [recordingToDelete, setRecordingToDelete] = useState<string | null>(null);
  const [deletingRecording, setDeletingRecording] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmState | null>(null);
  const [confirmingAction, setConfirmingAction] = useState(false);
  const detailSignatureRef = useRef("");
  const initialNotesRef = useRef<string | null>(null);

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
    setLoading(true);
    try {
      const nextDetail = await api.runs.get(runFolder);
      const nextSignature = buildAnalysisSignature(nextDetail);
      if (detailSignatureRef.current !== nextSignature) {
        invalidateAnalysisCache();
      }
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
    setActiveTabId("summary");
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
    detailSignatureRef.current = "";
    initialNotesRef.current = null;
  }, [runFolder]);

  useEffect(() => {
    let alive = true;
    setLoadingPrompts(true);
    void api.prompts.list()
      .then((list) => {
        if (!alive) return;
        setPrompts(list);
      })
      .catch(() => {
        if (!alive) return;
        setPrompts([]);
      })
      .finally(() => {
        if (alive) setLoadingPrompts(false);
      });
    return () => {
      alive = false;
    };
  }, [runFolder]);

  useEffect(() => {
    const unsub = api.on.pipelineProgress((event: PipelineProgressEvent) => {
      if (event.runFolder !== runFolder) return;
      setReprocessStarting(false);
      if (event.type === "run-failed") {
        setPipelineError(event.error);
      } else if (event.type === "output-start" || event.type === "run-complete") {
        setPipelineError(null);
      }
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

  useEffect(() => {
    let canceled = false;
    api.jobs.list().then((allJobs) => {
      if (canceled) return;
      setActiveJob(
        allJobs.find(
          (job) =>
            job.runFolder === runFolder &&
            (job.status === "queued" || job.status === "running")
        ) ?? null
      );
    }).catch(() => {});

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

  const startReprocess = async (request: ReprocessRequest) => {
    await api.runs.startReprocess(request);
    setSections([]);
    setPipelineError(null);
    setReprocessStarting(true);
    void refresh();
  };

  // Poll for updates when meeting is processing (fallback if events are missed)
  useEffect(() => {
    if (!detail || detail.status !== "processing") return;
    const id = setInterval(() => {
      void refresh();
    }, 7000);
    return () => clearInterval(id);
  }, [detail?.status, runFolder]);

  const defaultModel = useMemo(() => getDefaultPromptModel(config), [config]);

  const promptCollections = useMemo(() => {
    if (!detail) {
      return {
        primaryPrompt: null,
        summaryFileName: "summary.md",
        summaryStatus: undefined,
        summaryHasOutput: false,
        analysisPrompts: [] as MeetingAnalysisPromptItem[],
      };
    }
    const manifest = (detail.manifest ?? {}) as {
      sections?: Record<string, { filename?: string; label?: string; status?: string }>;
    };
    return buildMeetingPromptCollections({
      prompts,
      manifestOutputs: manifest.prompt_outputs ?? {},
      files: detail.files.filter((f): f is typeof f & { kind?: "document" | "log" | "media" } => f.kind !== "attachment"),
    });
  }, [detail, prompts]);

  const recordingFiles = useMemo(
    () => (detail ? detail.files.filter((file) => file.kind === "media") : []),
    [detail]
  );

  const sortedAnalysisPrompts = useMemo(
    () => [...promptCollections.analysisPrompts].sort(sortAnalysisPrompts),
    [promptCollections.analysisPrompts]
  );

  const filteredAnalysisPrompts = useMemo(() => {
    const query = analysisSearchQuery.trim().toLowerCase();
    if (!query) return sortedAnalysisPrompts;
    return sortedAnalysisPrompts.filter((prompt) => {
      return (
        prompt.label.toLowerCase().includes(query) ||
        prompt.id.toLowerCase().includes(query) ||
        (prompt.description?.toLowerCase().includes(query) ?? false)
      );
    });
  }, [analysisSearchQuery, sortedAnalysisPrompts]);

  const analysisPreloadedPrompts = useMemo(
    () => filteredAnalysisPrompts.filter((prompt) => prompt.prompt.builtin),
    [filteredAnalysisPrompts]
  );

  const analysisCustomPrompts = useMemo(
    () => filteredAnalysisPrompts.filter((prompt) => !prompt.prompt.builtin),
    [filteredAnalysisPrompts]
  );

  useEffect(() => {
    if (
      activePromptId &&
      sortedAnalysisPrompts.some((prompt) => prompt.id === activePromptId)
    ) {
      return;
    }
    const firstComplete =
      sortedAnalysisPrompts.find(
        (prompt) => prompt.status === "complete" && prompt.hasOutput
      ) ?? sortedAnalysisPrompts[0];
    setActivePromptId(firstComplete?.id ?? null);
  }, [activePromptId, sortedAnalysisPrompts]);

  useEffect(() => {
    if (activeTabId !== "recording" || recordingFiles.length === 0) return;
    const missing = recordingFiles.filter((file) => !recordingSources[file.name]);
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
    return () => {
      canceled = true;
    };
  }, [activeTabId, recordingFiles, recordingSources, runFolder]);

  useEffect(() => {
    if (!detail) return;
    let filePath: string | null = null;
    let cacheKey: string | null = null;
    if (activeTabId === "summary") {
      filePath = promptCollections.summaryFileName;
      cacheKey = "summary";
    } else if (activeTabId === "notes") {
      filePath = "notes.md";
      cacheKey = "notes";
    } else if (activeTabId === "transcript") {
      filePath = "transcript.md";
      cacheKey = "transcript";
    } else if (activeTabId === "analysis" && activePromptId) {
      const activePrompt = promptCollections.analysisPrompts.find(
        (prompt) => prompt.id === activePromptId
      );
      if (activePrompt) {
        filePath = activePrompt.fileName;
        cacheKey = `prompt:${activePrompt.id}`;
      }
    }
    if (!filePath || !cacheKey || tabContents[cacheKey] != null) return;
    api.runs
      .readDocument(runFolder, filePath)
      .then((content) => {
        setTabContents((prev) => ({ ...prev, [cacheKey!]: content }));
        if (cacheKey === "notes") {
          initialNotesRef.current = content;
        }
      })
      .catch((err) => {
        if (err instanceof Error && /ENOENT/i.test(err.message)) {
          return;
        }
        setTabContents((prev) => ({
          ...prev,
          [cacheKey!]: "_(unable to load file)_",
        }));
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

  const isCompletedMeeting =
    detail != null && !["recording", "processing"].includes(detail.status);

  const summaryContent = tabContents.summary ?? "";
  const notesContent = tabContents.notes ?? "";
  const transcriptContent = tabContents.transcript ?? "";
  const activePrompt = activePromptId
    ? sortedAnalysisPrompts.find((prompt) => prompt.id === activePromptId) ?? null
    : null;
  const promptContent = activePromptId ? tabContents[`prompt:${activePromptId}`] ?? "" : "";
  const recordingPendingDelete =
    recordingToDelete != null
      ? recordingFiles.find((file) => file.name === recordingToDelete) ?? null
      : null;

  const isNotesDirty = notesEditMode && isCompletedMeeting && tabContents.notes !== initialNotesRef.current;

  // Update parent about dirty state
  useEffect(() => {
    onDirtyChange?.(isNotesDirty);
  }, [isNotesDirty, onDirtyChange]);

  // Window Close Guard
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isNotesDirty) {
        e.preventDefault();
        e.returnValue = "You have unsaved notes. Are you sure you want to leave?";
        return e.returnValue;
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isNotesDirty]);

  const onNotesChange = (value: string) => {
    setTabContents((prev) => ({ ...prev, notes: value }));
  };

  const saveNotes = async () => {
    if (tabContents.notes == null) return;
    await api.runs.writeNotes(runFolder, tabContents.notes);
    initialNotesRef.current = tabContents.notes;
    setNotesEditMode(false);
  };

  const onNotesBlur = () => {
    if (isCompletedMeeting || tabContents.notes == null) return;
    api.runs.writeNotes(runFolder, tabContents.notes).catch(() => {});
  };

  const runSummary = async () => {
    await startReprocess({
      runFolder,
      onlyIds: [PRIMARY_PROMPT_ID],
    });
  };

  const runSelectedAnalysisPrompt = async () => {
    if (!activePrompt) return;
    await startReprocess({
      runFolder,
      onlyIds: [activePrompt.id],
    });
  };

  const requestNotesDiscard = (action: () => void, description = "You have unsaved notes. Discard your changes and continue?") => {
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

  const onDelete = async () => {
    setPendingConfirm({
      title: "Delete meeting?",
      description: "This permanently deletes the meeting and all of its files from disk.",
      confirmLabel: "Delete meeting",
      confirmingLabel: "Deleting…",
      cancelLabel: "Keep meeting",
      confirmVariant: "destructive",
      action: async () => {
        await api.runs.deleteRun(runFolder);
        onBack();
      },
    });
  };

  const onDownloadRecording = async (fileName: string) => {
    await api.runs.downloadMedia(runFolder, fileName);
  };

  const onConfirmDeleteRecording = async () => {
    if (!recordingPendingDelete) return;
    setDeletingRecording(true);
    try {
      await api.runs.deleteMedia(runFolder, recordingPendingDelete.name);
      setRecordingSources((prev) => {
        if (!(recordingPendingDelete.name in prev)) return prev;
        const next = { ...prev };
        delete next[recordingPendingDelete.name];
        return next;
      });
      setRecordingToDelete(null);
      await refresh();
    } finally {
      setDeletingRecording(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-[var(--border-default)] bg-white px-4 py-4 text-sm text-[var(--text-secondary)]">
        <Spinner />
        Loading meeting…
      </div>
    );
  }

  if (error) {
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

  const obsidianTargetPath =
    activeTabId === "summary"
      ? promptCollections.summaryFileName
      : activeTabId === "notes"
      ? "notes.md"
      : activeTabId === "transcript"
      ? "transcript.md"
      : activeTabId === "analysis" && activePrompt
      ? activePrompt.fileName
      : null;

  const showPipelineStatus =
    reprocessStarting ||
    detail.status === "processing" ||
    sections.length > 0 ||
    pipelineError != null ||
    activeJob != null;

  const pipelineStatusContent = showPipelineStatus ? (
    <div className="space-y-3">
      <PipelineStatus
        sections={sections}
        title={
          reprocessStarting && sections.length === 0
            ? "Reprocess queued for this meeting"
            : "Processing"
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

  const activePromptSection = activePromptId
    ? sections.find((s) => s.id === activePromptId)
    : null;

  const analysisPipelineContent = activePromptSection ? (
    <PipelineStatus
      sections={[activePromptSection]}
      title="Processing"
      description={activePromptSection.label}
      status={activePromptSection.state === "complete" ? "completed"
        : activePromptSection.state === "failed" ? "failed"
        : "processing"}
      compact
    />
  ) : null;

  return (
    <PageScaffold className="gap-4 overflow-hidden md:gap-5">
      <MeetingHeader
        status={detail.status}
        title={detail.title}
        description={detail.description}
        duration={detail.duration_minutes}
        timestamp={detail.started || detail.date}
        onTitleSave={(v) => {
          api.runs.updateMeta({ runFolder, title: v }).catch(() => {});
          setDetail((prev) => prev ? { ...prev, title: v } : prev);
        }}
        onDescriptionSave={(v) => {
          api.runs.updateMeta({ runFolder, description: v.trim() || null }).catch(() => {});
          setDetail((prev) => prev ? { ...prev, description: v.trim() || null } : prev);
        }}
        onBack={() => requestNotesDiscard(onBack)}
        actions={
          <>
            {detail.status === "complete" && (
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
                <PlayCircle className="h-3.5 w-3.5" />
                Continue recording
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => setChatLauncherOpen(true)}>
              <ExternalLink className="h-3.5 w-3.5" />
              Launch chat
            </Button>
            {(detail.status === "complete" || detail.status === "error") && onOpenPrep && (
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  try {
                    await api.runs.reopenAsDraft(runFolder);
                    onOpenPrep(runFolder);
                  } catch (err) {
                    console.error("Reopen as draft failed", err);
                  }
                }}
              >
                <SquarePen className="h-3.5 w-3.5" />
                Edit
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => setReprocessOpen(true)}>
                  Reprocess
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => api.runs.openInFinder(runFolder)}>
                  Open folder
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onDelete} className="text-[var(--error)]">
                  Delete meeting
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {detail.status === "error" && !showPipelineStatus && (() => {
        const failedOutputs = Object.entries(detail.manifest?.prompt_outputs ?? {})
          .filter(([, output]) => output?.status === "failed" && output.error)
          .map(([id, output]) => ({ id, label: output.label ?? id, error: output.error! }));
        if (failedOutputs.length === 0) return null;
        return (
          <div className="flex items-start gap-3 rounded-lg border border-[color:rgba(185,28,28,0.18)] bg-[rgba(185,28,28,0.06)] px-4 py-3 text-sm text-[var(--error)]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              {failedOutputs.map(({ id, label, error }) => (
                <div key={id}>
                  <span className="font-medium">{label}</span>{" "}
                  failed: {error}
                </div>
              ))}
              <div className="mt-2 text-xs text-[var(--text-secondary)]">
                Use Reprocess to retry the failed step(s).
              </div>
            </div>
          </div>
        );
      })()}

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
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="analysis">Analysis</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="transcript">Transcript</TabsTrigger>
          <TabsTrigger value="recording">Recording</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="metadata">Metadata</TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <Card className="p-4 md:p-6">
            <CardHeader className="mb-4">
              <div className="space-y-2">
                <Badge variant="accent" className="w-fit">
                  Primary prompt
                </Badge>
                <CardTitle className="text-xl">
                  {promptCollections.primaryPrompt?.label ?? "Summary"}
                </CardTitle>
                <p className="text-sm text-[var(--text-secondary)]">
                  {promptCollections.primaryPrompt?.description?.trim()
                    ? promptCollections.primaryPrompt.description
                    : "The primary meeting recap lives here. Use Analysis for any secondary prompts and outputs."}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void runSummary()}
                >
                  <RefreshCcw className="h-3.5 w-3.5" />
                  Refresh summary
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpenPromptLibrary(PRIMARY_PROMPT_ID)}
                >
                  <SquarePen className="h-3.5 w-3.5" />
                  Edit summary prompt
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {pipelineStatusContent}
              {promptCollections.summaryHasOutput ? (
                <MarkdownView source={summaryContent} className="markdown-view" />
              ) : (
                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-5 text-sm text-[var(--text-secondary)]">
                  No summary has been generated for this meeting yet. Refresh the summary to create the primary recap.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analysis">
          <div className="flex h-[calc(100vh-var(--header-height)-10rem)] min-h-[24rem] overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-white shadow-sm">
            <div className="flex w-52 shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-secondary)]/30 lg:w-64">
              <div className="space-y-4 p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-[var(--text-primary)]">Library</h2>
                </div>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                  <Input
                    placeholder="Filter..."
                    className="h-8 bg-white/60 pl-8 text-xs focus:bg-white"
                    value={analysisSearchQuery}
                    onChange={(event) => setAnalysisSearchQuery(event.target.value)}
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-2 pb-4">
                {loadingPrompts ? (
                  <div className="px-4 py-3 text-sm text-[var(--text-secondary)]">
                    <div className="flex items-center gap-2">
                      <Spinner className="h-3.5 w-3.5" />
                      Loading prompts…
                    </div>
                  </div>
                ) : sortedAnalysisPrompts.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-[var(--text-secondary)]">
                    No analysis prompts yet.
                  </div>
                ) : filteredAnalysisPrompts.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-[var(--text-secondary)]">
                    No prompts match this filter.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {analysisPreloadedPrompts.length > 0 ? (
                      <div className="space-y-1 px-2" data-testid="analysis-category-pre-loaded">
                        <div className="px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--text-tertiary)]/70">
                          Pre-loaded
                        </div>
                        <div className="space-y-0.5">
                          {analysisPreloadedPrompts.map((prompt) => (
                            <AnalysisSidebarItem
                              key={prompt.id}
                              prompt={prompt}
                              active={activePromptId === prompt.id}
                              onSelect={() => setActivePromptId(prompt.id)}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="space-y-1 px-2" data-testid="analysis-category-custom">
                      <div className="px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--text-tertiary)]/70">
                        Custom
                      </div>
                      <div className="space-y-0.5">
                        {analysisCustomPrompts.length === 0 ? (
                          <div className="px-3 py-2 text-[11px] italic text-[var(--text-tertiary)]">
                            No custom prompts yet
                          </div>
                        ) : (
                          analysisCustomPrompts.map((prompt) => (
                            <AnalysisSidebarItem
                              key={prompt.id}
                              prompt={prompt}
                              active={activePromptId === prompt.id}
                              onSelect={() => setActivePromptId(prompt.id)}
                            />
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="min-w-0 flex-1 overflow-y-auto">
              {activePrompt ? (
                <div className="space-y-6 p-5 md:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border-subtle)] pb-5">
                    <div className="min-w-0 space-y-2">
                      <h2 className="text-2xl font-semibold text-[var(--text-primary)]">
                        {activePrompt.label}
                      </h2>
                      <p className="max-w-3xl text-sm text-[var(--text-secondary)]">
                        {activePrompt.description?.trim()
                          ? activePrompt.description
                          : "No description yet. Use this prompt when you want a meeting-specific analysis beyond the primary summary."}
                      </p>
                      {(() => {
                        const effectiveModel = activePrompt.prompt.model ?? defaultModel;
                        const modelLabel = effectiveModel
                          ? (findModelEntry(effectiveModel)?.label ?? effectiveModel)
                          : null;
                        return modelLabel ? (
                          <p className="text-[11px] font-medium text-[var(--text-tertiary)]">
                            {modelLabel}{activePrompt.prompt.model ? "" : " (default)"}
                          </p>
                        ) : null;
                      })()}
                    </div>
                    <Button size="sm" onClick={() => void runSelectedAnalysisPrompt()}>
                      <PlayCircle className="h-3.5 w-3.5" />
                      Run prompt
                    </Button>
                  </div>

                  {analysisPipelineContent}

                  {activePrompt.hasOutput ? (
                    <div className="rounded-xl border border-[var(--border-subtle)] bg-white p-5 md:p-6">
                      <MarkdownView source={promptContent} className="markdown-view" />
                    </div>
                  ) : (
                    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-5 py-6 text-sm text-[var(--text-secondary)]">
                      This prompt has not produced an output for this meeting yet. Use the run button above to generate it.
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-5 md:p-6">
                  {analysisPipelineContent}
                  <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-5 py-6 text-sm text-[var(--text-secondary)]">
                    Select an analysis prompt to view its output for this meeting.
                  </div>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="notes">
          <div className="flex flex-1 min-h-0 flex-col gap-4">
            {isCompletedMeeting && !notesEditMode ? (
              <Card className="p-4 md:p-6">
                <CardHeader className="mb-4">
                  <div className="space-y-2">
                    <Badge variant="neutral" className="w-fit">
                      Read mode
                    </Badge>
                    <CardTitle className="text-xl">View mode</CardTitle>
                  </div>
                  <Button onClick={() => setNotesEditMode(true)}>
                    <SquarePen className="h-4 w-4" />
                    Edit
                  </Button>
                </CardHeader>
                <CardContent>
                  <MarkdownView source={notesContent} className="markdown-view" />
                </CardContent>
              </Card>
            ) : (
              <Card className="flex flex-1 min-h-0 flex-col p-4">
                <CardHeader className="mb-4">
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-3">
                      <Badge variant={isCompletedMeeting ? "warning" : "accent"} className="w-fit">
                        {isCompletedMeeting ? "Editing unlocked" : "Live notes"}
                      </Badge>
                    </div>
                    <CardTitle className="text-xl">
                      {isCompletedMeeting ? "Edit completed meeting notes" : "Notes"}
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 min-h-0 flex-col gap-4">
                  <div className={`flex-1 min-h-0 overflow-hidden rounded-md border transition-colors bg-white ${isNotesDirty ? "border-[var(--warning)]/50 ring-1 ring-[var(--warning)]/10" : "border-[var(--border-default)]"}`}>
                    <MarkdownEditor
                      value={notesContent}
                      onChange={onNotesChange}
                      onBlur={onNotesBlur}
                    />
                  </div>
                  {isCompletedMeeting ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex gap-3">
                        <Button 
                          onClick={() => void saveNotes()} 
                          className={`transition-all duration-300 ${isNotesDirty ? "bg-[var(--accent)] shadow-lg ring-4 ring-[var(--accent)]/15 scale-105" : ""}`}
                        >
                          Save notes
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            requestNotesDiscard(
                              () => {
                                setNotesEditMode(false);
                                setTabContents((prev) => ({
                                  ...prev,
                                  notes: initialNotesRef.current ?? "",
                                }));
                              },
                              "Discard your note edits and return to read mode?"
                            );
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="transcript">
          <TranscriptView source={transcriptContent} />
        </TabsContent>

        <TabsContent value="recording">
          <div className="space-y-4">
            {recordingFiles.length === 0 ? (
              <Card className="p-4 md:p-6">
                <CardContent>
                  <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-4 text-sm text-[var(--text-secondary)]">
                    No source recordings are stored for this meeting.
                  </div>
                </CardContent>
              </Card>
            ) : (
              recordingFiles.map((file) => {
                const source = recordingSources[file.name];
                const audioPreview = isAudioRecording(file.name) && source;
                const videoRecording = isVideoRecording(file.name);
                return (
                  <Card key={file.name} className="p-4">
                    <CardHeader className="mb-4">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="neutral">{getRecordingTypeLabel(file.name)}</Badge>
                          <Badge variant="neutral">{formatFileSize(file.size)}</Badge>
                        </div>
                        <CardTitle className="text-lg break-all">{file.name}</CardTitle>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void onDownloadRecording(file.name)}
                        >
                          <FileOutput className="h-3.5 w-3.5" />
                          Download
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setRecordingToDelete(file.name)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {audioPreview ? (
                        <audio controls preload="metadata" src={source} className="w-full">
                          Your browser does not support audio playback.
                        </audio>
                      ) : videoRecording ? (
                        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-4 text-sm text-[var(--text-secondary)]">
                          Video preview isn&apos;t available in-app yet. Download this recording to view it.
                        </div>
                      ) : (
                        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-4 text-sm text-[var(--text-secondary)]">
                          Preview is not available for this recording type. Download the file to inspect it.
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </TabsContent>

        <TabsContent value="files">
          <FilesTab runFolder={runFolder} />
        </TabsContent>

        <TabsContent value="metadata">
          <OverviewPanel detail={detail} runFolder={runFolder} onUpdated={() => void refresh()} />
        </TabsContent>
      </Tabs>

      {config.obsidian_integration.enabled && obsidianTargetPath ? (
        <Button variant="secondary" onClick={() => void api.runs.openInObsidian(runFolder, obsidianTargetPath)}>
          Open in Obsidian
        </Button>
      ) : null}

      {reprocessOpen ? (
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
      ) : null}

      {chatLauncherOpen && detail ? (
        <ChatLauncherModal
          runFolder={runFolder}
          detail={detail}
          config={config}
          onClose={() => setChatLauncherOpen(false)}
        />
      ) : null}

      <Dialog
        open={recordingPendingDelete != null}
        onOpenChange={(open) => {
          if (!open && !deletingRecording) {
            setRecordingToDelete(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete recording?</DialogTitle>
            <DialogDescription>
              This removes the selected source recording from disk but keeps the meeting, notes,
              transcript, and analysis files. Future reprocessing may fail if this recording is
              needed again.
            </DialogDescription>
          </DialogHeader>
          {recordingPendingDelete ? (
            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--text-primary)] break-all">
              {recordingPendingDelete.name}
            </div>
          ) : null}
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
                  <Spinner />
                  Deleting…
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
          if (!open && !confirmingAction) {
            setPendingConfirm(null);
          }
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
    </PageScaffold>
  );
}

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

function AnalysisSidebarItem({
  prompt,
  active,
  onSelect,
}: {
  prompt: MeetingAnalysisPromptItem;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group relative flex w-full items-center justify-between rounded-md px-3 py-[7px] text-left transition-all ${
        active
          ? "bg-white font-semibold text-[var(--text-primary)] shadow-sm ring-1 ring-black/5"
          : "text-[var(--text-secondary)] hover:bg-white/60 hover:text-[var(--text-primary)]"
      }`}
    >
      <div className="min-w-0">
        <span className="block truncate text-xs leading-snug">{prompt.label}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {prompt.status === "running" || prompt.status === "queued" ? (
          <Spinner className="h-3 w-3 text-[var(--text-tertiary)]" />
        ) : prompt.status === "failed" ? (
          <AlertCircle className="h-3 w-3 text-red-400" />
        ) : prompt.hasOutput ? (
          <Check className="h-3 w-3 text-[var(--accent)]" />
        ) : null}
      </div>
      {active && (
        <div className="absolute inset-y-0 left-0 my-auto h-4 w-0.5 rounded-full bg-[var(--accent)]" />
      )}
    </button>
  );
}

// ---- Files tab component ----

function FilesTab({ runFolder }: { runFolder: string }) {
  const [attachments, setAttachments] = useState<Array<{ name: string; size: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.runs.listAttachments(runFolder)
      .then(setAttachments)
      .catch(() => setAttachments([]))
      .finally(() => setLoading(false));
  }, [runFolder]);

  const onAdd = async () => {
    const result = await api.runs.addAttachment(runFolder);
    if (result) setAttachments((prev) => [...prev, { name: result.fileName, size: result.size }]);
  };

  const onRemove = async (name: string) => {
    await api.runs.removeAttachment(runFolder, name);
    setAttachments((prev) => prev.filter((a) => a.name !== name));
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (loading) {
    return <div className="py-8 text-center text-sm text-[var(--text-secondary)]">Loading…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-[var(--text-primary)]">
          Attached files ({attachments.length})
        </h3>
        <Button variant="secondary" size="sm" onClick={onAdd}>
          Add file
        </Button>
      </div>
      {attachments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-default)] bg-[var(--bg-secondary)]/50 px-6 py-8 text-center text-sm text-[var(--text-secondary)]">
          No files attached. Add reference documents, slides, or other materials.
        </div>
      ) : (
        <div className="space-y-1.5">
          {attachments.map((a) => (
            <div
              key={a.name}
              className="flex items-center justify-between rounded-lg border border-[var(--border-default)] bg-white px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-[var(--text-primary)]">{a.name}</div>
                <div className="text-xs text-[var(--text-tertiary)]">{formatSize(a.size)}</div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRemove(a.name)}
                className="ml-2 text-[var(--text-tertiary)] hover:text-[var(--error)]"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
