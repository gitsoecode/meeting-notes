import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  X,
} from "lucide-react";
import type {
  JobProgressStep,
  JobStatus,
  PipelineProgressEvent,
} from "../../../shared/ipc";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Spinner } from "./ui/spinner";

export type PromptOutputStepState = "queued" | "running" | "complete" | "failed" | "canceled";

export interface PromptOutputStatus {
  id: string;
  label: string;
  state: PromptOutputStepState;
  kind: "transcript" | "prompt";
  filename?: string;
  latencyMs?: number;
  error?: string;
  startedAt?: number;
  model?: string;
}

interface PipelineStatusProps {
  sections: PromptOutputStatus[];
  title?: string;
  description?: string;
  status?: JobStatus | "processing";
  queuePosition?: number;
  currentLabel?: string;
  showPreparingWhenEmpty?: boolean;
  compact?: boolean;
  action?: ReactNode;
}

export function PipelineStatus({
  sections,
  title = "Processing",
  description,
  status = "processing",
  queuePosition,
  currentLabel,
  showPreparingWhenEmpty = false,
  compact = false,
  action,
}: PipelineStatusProps) {
  const anyRunning = sections.some((section) => section.state === "running");
  const visibleSections = useMemo(() => {
    if (sections.length > 0 || !showPreparingWhenEmpty) return sections;
    return [
      {
        id: "__preparing__",
        label: "Preparing processing pipeline",
        state: "running" as const,
        kind: "prompt" as const,
      },
    ];
  }, [sections, showPreparingWhenEmpty]);
  const completed = visibleSections.filter((section) => section.state === "complete").length;
  const failed = visibleSections.filter((section) => section.state === "failed").length;
  const total = visibleSections.length;
  const effectiveStatus = resolvePipelineStatus(status, sections);
  const displaySections = useMemo(() => {
    if (effectiveStatus !== "canceled") return visibleSections;
    return visibleSections.map((section) =>
      section.state === "running" ? { ...section, state: "canceled" as const } : section
    );
  }, [effectiveStatus, visibleSections]);
  const finished =
    effectiveStatus === "completed" || effectiveStatus === "failed" || effectiveStatus === "canceled";
  const [expanded, setExpanded] = useState(!finished);

  useEffect(() => {
    setExpanded(!finished);
  }, [finished, title]);

  const summary = buildSummary({
    status: effectiveStatus,
    completed,
    failed,
    total,
    queuePosition,
    currentLabel,
  });

  const [, setTick] = useState(0);
  useEffect(() => {
    if (!anyRunning) return;
    const id = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, [anyRunning]);

  return (
    <Card className={cn(
      "border-[var(--border-default)] bg-white shadow-none",
      compact ? "rounded-xl" : "rounded-2xl"
    )}>
      <CardContent className={cn("space-y-3", compact ? "p-4" : "p-5")}>
        <div className="flex items-start gap-3">
          <div className="flex h-5 w-5 shrink-0 items-center justify-center pt-0.5">
            <StatusIcon status={effectiveStatus} />
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className={cn(
                  "font-semibold text-[var(--text-primary)]",
                  compact ? "text-sm" : "text-base"
                )}>
                  {title}
                </div>
                <div className="text-sm text-[var(--text-secondary)]">
                  {description ?? summary}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {action}
                {finished || visibleSections.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setExpanded((value) => !value)}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                  >
                    {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    {expanded ? "Hide details" : "Show details"}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
              <span>{statusLabel(effectiveStatus)}</span>
              {total > 0 ? <span>{completed}/{total} complete</span> : null}
              {failed > 0 ? <span>{failed} failed</span> : null}
              {currentLabel && !finished ? <span>Current: {currentLabel}</span> : null}
            </div>

            <div className="h-px bg-[var(--border-subtle)]" />

            {expanded ? (
              <div className="space-y-2">
                {displaySections.map((section) => (
                  <StepRow key={section.id} section={section} />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StepRow({ section }: { section: PromptOutputStatus }) {
  const elapsedSec =
    section.state === "running" && section.startedAt
      ? Math.floor((Date.now() - section.startedAt) / 1000)
      : null;

  return (
    <div className="flex items-start gap-3 py-1">
      <div className="flex h-5 w-5 shrink-0 items-center justify-center">
        <StepIcon state={section.state} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-[var(--text-primary)]">{section.label}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
          <span>{section.kind === "transcript" ? "Transcript" : "Prompt"}</span>
          {section.state === "running" && elapsedSec != null ? (
            <span>{elapsedSec}s elapsed</span>
          ) : null}
          {section.state === "canceled" ? <span>Canceled</span> : null}
          {section.state === "complete" && section.latencyMs != null ? (
            <span>{(section.latencyMs / 1000).toFixed(1)}s</span>
          ) : null}
          {section.filename ? <span>{section.filename}</span> : null}
        </div>
        {section.error ? (
          <div className="mt-1 text-xs text-[var(--error)]">{section.error}</div>
        ) : null}
      </div>
    </div>
  );
}

export function ProcessingStatusInline({
  status,
  currentLabel,
}: {
  status: JobStatus | "processing";
  currentLabel?: string;
}) {
  const resolvedStatus = resolvePipelineStatus(status);
  return (
    <div className="flex min-w-0 items-center gap-2">
      {resolvedStatus === "processing" || resolvedStatus === "running" ? <Spinner className="h-3.5 w-3.5" /> : null}
      <span className="truncate text-xs text-[var(--text-secondary)]">
        {currentLabel ?? statusLabel(resolvedStatus)}
      </span>
    </div>
  );
}

export function resolvePipelineStatus(
  status: JobStatus | "processing",
  sections: PromptOutputStatus[] = []
): JobStatus | "processing" {
  if (status !== "processing" && status !== "running") {
    return status;
  }
  if (sections.some((section) => section.state === "running")) {
    return status;
  }
  if (sections.length === 0) {
    return status;
  }
  const terminalSections = sections.filter(
    (section) => section.state === "complete" || section.state === "failed"
  );
  if (terminalSections.length !== sections.length) {
    return status;
  }
  return sections.some((section) => section.state === "failed") ? "failed" : "completed";
}

function StatusIcon({ status }: { status: JobStatus | "processing" }) {
  if (status === "completed") return <Check className="h-4 w-4 text-[var(--text-primary)]" />;
  if (status === "failed") return <AlertCircle className="h-4 w-4 text-[var(--error)]" />;
  if (status === "queued") return <Clock3 className="h-4 w-4 text-[var(--text-secondary)]" />;
  if (status === "canceled") return <X className="h-4 w-4 text-[var(--text-secondary)]" />;
  return <Spinner className="h-4 w-4" />;
}

function StepIcon({ state }: { state: PromptOutputStepState }) {
  if (state === "complete") return <Check className="h-4 w-4 text-[var(--text-secondary)]" />;
  if (state === "failed") return <AlertCircle className="h-4 w-4 text-[var(--error)]" />;
  if (state === "canceled") return <X className="h-4 w-4 text-[var(--text-secondary)]" />;
  if (state === "running") return <Spinner className="h-4 w-4" />;
  return <Circle className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />;
}

function buildSummary({
  status,
  completed,
  failed,
  total,
  queuePosition,
  currentLabel,
}: {
  status: JobStatus | "processing";
  completed: number;
  failed: number;
  total: number;
  queuePosition?: number;
  currentLabel?: string;
}) {
  if (status === "queued") {
    return queuePosition ? `Queued · position ${queuePosition}` : "Queued";
  }
  if (status === "failed") {
    return failed > 0 ? `Failed after ${completed}/${total} completed` : "Failed";
  }
  if (status === "completed") {
    return `${completed}/${total} steps completed`;
  }
  if (currentLabel) {
    return currentLabel;
  }
  if (total > 0) {
    return `${completed}/${total} steps completed`;
  }
  return "Preparing processing pipeline";
}

function statusLabel(status: JobStatus | "processing") {
  if (status === "running") return "Processing";
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  if (status === "queued") return "Queued";
  if (status === "canceled") return "Canceled";
  return "Processing";
}

export function outputsFromJobSteps(steps?: JobProgressStep[]): PromptOutputStatus[] {
  return (steps ?? []).map((step) => ({
    id: step.promptOutputId,
    label: step.label,
    state: step.state,
    kind: step.kind,
    filename: step.filename,
    latencyMs: step.latencyMs,
    error: step.error,
    startedAt: step.startedAt,
    model: step.model,
  }));
}

export function applyProgress(
  prev: PromptOutputStatus[],
  event: PipelineProgressEvent
): PromptOutputStatus[] {
  switch (event.type) {
    case "run-planned":
      return event.steps.map((step) => ({
        id: step.promptOutputId,
        label: step.label,
        state: "queued",
        kind: step.kind,
        filename: step.filename,
        model: step.model,
      }));
    case "output-start": {
      const startedAt = Date.now();
      const existing = prev.find((entry) => entry.id === event.promptOutputId);
      if (existing) {
        return prev.map((entry) =>
          entry.id === event.promptOutputId
            ? {
                ...entry,
                state: "running",
                startedAt,
                model: event.model ?? entry.model,
              }
            : entry
        );
      }
      return [
        ...prev,
        {
          id: event.promptOutputId,
          label: event.label,
          state: "running",
          startedAt,
          model: event.model,
          filename: event.filename,
          kind: event.promptOutputId === "__transcript__" ? "transcript" : "prompt",
        },
      ];
    }
    case "output-complete":
      return prev.some((entry) => entry.id === event.promptOutputId)
        ? prev.map((entry) =>
            entry.id === event.promptOutputId
              ? { ...entry, state: "complete", latencyMs: event.latencyMs }
              : entry
          )
        : [
            ...prev,
            {
              id: event.promptOutputId,
              label: event.label,
              state: "complete",
              kind: event.promptOutputId === "__transcript__" ? "transcript" : "prompt",
              filename: event.filename,
              latencyMs: event.latencyMs,
            },
          ];
    case "output-failed":
      return prev.some((entry) => entry.id === event.promptOutputId)
        ? prev.map((entry) =>
            entry.id === event.promptOutputId
              ? {
                  ...entry,
                  state: "failed",
                  latencyMs: event.latencyMs,
                  error: event.error,
                }
              : entry
          )
        : [
            ...prev,
            {
              id: event.promptOutputId,
              label: event.label,
              state: "failed",
              kind: event.promptOutputId === "__transcript__" ? "transcript" : "prompt",
              filename: event.filename,
              latencyMs: event.latencyMs,
              error: event.error,
            },
          ];
    default:
      return prev;
  }
}

export function CancelJobButton({
  jobId,
  disabled,
  onCancel,
}: {
  jobId: string;
  disabled?: boolean;
  onCancel: (jobId: string) => void | Promise<void>;
}) {
  return (
    <Button variant="secondary" size="sm" onClick={() => void onCancel(jobId)} disabled={disabled}>
      Cancel
    </Button>
  );
}
