import {
  createAppLogger,
  getAppLogPath,
  loadConfig,
  loadRunManifest,
  OperationAbortedError,
  type PipelineProgressEvent,
  type RunManifest,
  updateRunStatus,
} from "@meeting-notes/engine";
import type {
  JobKind,
  JobProgress,
  JobProgressStep,
  JobSummary,
  PipelinePlannedStep,
} from "../shared/ipc.js";
import { resolveRunDocumentPath, resolveRunFolderPath, RUN_LOG_FILE } from "./run-access.js";
import { broadcastToAll } from "./events.js";

type JobTask<T> = (ctx: {
  signal: AbortSignal;
  updateProgress: (event: PipelineProgressEvent) => void;
}) => Promise<T>;

interface ScheduleJobOptions<T> {
  kind: JobKind;
  title: string;
  subtitle: string;
  runFolder?: string;
  promptIds?: string[];
  provider?: string;
  model?: string;
  task: JobTask<T>;
}

interface InternalJob extends JobSummary {
  controller: AbortController;
  task: JobTask<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  seenSections: Set<string>;
}

const jobs = new Map<string, InternalJob>();
const queue: string[] = [];
let activeJobId: string | null = null;
let nextJobId = 1;
const appLogger = createAppLogger(false);

function isAbortLikeError(err: unknown): boolean {
  return (
    err instanceof OperationAbortedError ||
    (err instanceof Error && err.name === "AbortError")
  );
}

function emptyProgress(): JobProgress {
  return {
    completedSections: 0,
    failedSections: 0,
    totalSections: 0,
    steps: [],
  };
}

function normalizePlannedSteps(steps: PipelinePlannedStep[]): JobProgressStep[] {
  return steps.map((step) => ({
    ...step,
    state: "queued",
  }));
}

function updateStep(
  steps: JobProgressStep[],
  sectionId: string,
  updater: (step: JobProgressStep) => JobProgressStep,
  fallback?: () => JobProgressStep
): JobProgressStep[] {
  let found = false;
  const next = steps.map((step) => {
    if (step.sectionId !== sectionId) return step;
    found = true;
    return updater(step);
  });
  if (!found && fallback) {
    next.push(fallback());
  }
  return next;
}

function emitJob(job: InternalJob): void {
  broadcastToAll("jobs:update", toJobSummary(job));
}

function toJobSummary(job: InternalJob): JobSummary {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    title: job.title,
    subtitle: job.subtitle,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    cancelable: job.cancelable,
    queuePosition: job.queuePosition,
    runFolder: job.runFolder,
    promptIds: job.promptIds,
    provider: job.provider,
    model: job.model,
    progress: { ...job.progress },
    error: job.error,
  };
}

function recalculateQueuePositions(): void {
  for (const job of jobs.values()) {
    const nextPos =
      job.status === "queued" ? queue.indexOf(job.id) + 1 || undefined : undefined;
    if (job.queuePosition !== nextPos) {
      job.queuePosition = nextPos;
      emitJob(job);
    }
  }
}

function finalizeJob(job: InternalJob, status: JobSummary["status"], error?: string): void {
  job.status = status;
  job.endedAt = new Date().toISOString();
  job.cancelable = false;
  job.queuePosition = undefined;
  if (error) job.error = error;
  if (status === "failed") {
    appLogger.error("Job failed", {
      jobId: job.id,
      runFolder: job.runFolder,
      detail: error,
    });
  } else if (status === "completed") {
    appLogger.info("Job completed", {
      jobId: job.id,
      runFolder: job.runFolder,
      detail: job.title,
    });
  } else if (status === "canceled") {
    appLogger.warn("Job canceled", {
      jobId: job.id,
      runFolder: job.runFolder,
      detail: job.title,
    });
  }
  emitJob(job);
}

function dequeueNext(): void {
  if (activeJobId || queue.length === 0) {
    recalculateQueuePositions();
    return;
  }
  const nextId = queue.shift();
  if (!nextId) return;
  const nextJob = jobs.get(nextId);
  if (!nextJob || nextJob.status !== "queued") {
    dequeueNext();
    return;
  }
  void startJob(nextJob);
}

async function startJob(job: InternalJob): Promise<void> {
  activeJobId = job.id;
  job.status = "running";
  job.startedAt = new Date().toISOString();
  job.queuePosition = undefined;
  emitJob(job);
  appLogger.info("Job started", {
    jobId: job.id,
    runFolder: job.runFolder,
    detail: job.title,
  });
  recalculateQueuePositions();

  try {
    const result = await job.task({
      signal: job.controller.signal,
      updateProgress: (event) => updateJobProgress(job.id, event),
    });
    finalizeJob(job, "completed");
    job.resolve(result);
  } catch (err) {
    if (isAbortLikeError(err)) {
      if (job.runFolder) {
        try {
          const manifest = loadRunManifestSafe(job.runFolder);
          if (manifest && manifest.status === "processing") {
            updateRunStatus(job.runFolder, "aborted", { ended: new Date().toISOString() });
          }
        } catch {
          // best effort
        }
      }
      finalizeJob(job, "canceled");
      job.reject(err);
    } else {
      const message = err instanceof Error ? err.message : String(err);
      finalizeJob(job, "failed", message);
      job.reject(err);
    }
  } finally {
    if (activeJobId === job.id) activeJobId = null;
    dequeueNext();
  }
}

function loadRunManifestSafe(runFolder: string): RunManifest | null {
  try {
    const config = loadConfig();
    const validatedRunFolder = resolveRunFolderPath(runFolder, config);
    return loadRunManifest(validatedRunFolder);
  } catch {
    return null;
  }
}

export function listJobs(): JobSummary[] {
  return [...jobs.values()]
    .map(toJobSummary)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function updateJobProgress(jobId: string, event: PipelineProgressEvent): void {
  const job = jobs.get(jobId);
  if (!job) return;

  if (event.type === "run-planned") {
    job.progress.steps = normalizePlannedSteps(event.steps);
    job.progress.totalSections = event.steps.length;
    if (!job.progress.currentSectionLabel && event.steps.length > 0) {
      job.progress.currentSectionLabel = event.steps[0].label;
    }
  } else if (event.type === "section-start") {
    job.seenSections.add(event.sectionId);
    job.progress.totalSections = Math.max(job.progress.totalSections, job.seenSections.size);
    job.progress.currentSectionLabel = event.label;
    const startedAt = Date.now();
    job.progress.steps = updateStep(
      job.progress.steps,
      event.sectionId,
      (step) => ({
        ...step,
        state: "running",
        startedAt,
        model: event.model ?? step.model,
      }),
      () => ({
        sectionId: event.sectionId,
        label: event.label,
        filename: event.filename,
        model: event.model,
        kind: "prompt",
        state: "running",
        startedAt,
      })
    );
  } else if (event.type === "section-complete") {
    job.seenSections.add(event.sectionId);
    job.progress.completedSections += 1;
    job.progress.totalSections = Math.max(
      job.progress.totalSections,
      job.progress.completedSections + job.progress.failedSections,
      job.seenSections.size
    );
    job.progress.currentSectionLabel = event.label;
    job.progress.steps = updateStep(
      job.progress.steps,
      event.sectionId,
      (step) => ({
        ...step,
        state: "complete",
        latencyMs: event.latencyMs,
      }),
      () => ({
        sectionId: event.sectionId,
        label: event.label,
        filename: event.filename,
        kind: "prompt",
        state: "complete",
        latencyMs: event.latencyMs,
      })
    );
  } else if (event.type === "section-failed") {
    job.seenSections.add(event.sectionId);
    job.progress.failedSections += 1;
    job.progress.totalSections = Math.max(
      job.progress.totalSections,
      job.progress.completedSections + job.progress.failedSections,
      job.seenSections.size
    );
    job.progress.currentSectionLabel = event.label;
    job.progress.steps = updateStep(
      job.progress.steps,
      event.sectionId,
      (step) => ({
        ...step,
        state: "failed",
        latencyMs: event.latencyMs,
        error: event.error,
      }),
      () => ({
        sectionId: event.sectionId,
        label: event.label,
        filename: event.filename,
        kind: "prompt",
        state: "failed",
        latencyMs: event.latencyMs,
        error: event.error,
      })
    );
  }

  emitJob(job);
}

export function cancelJob(jobId: string): void {
  const job = jobs.get(jobId);
  if (!job) {
    throw new Error("Job not found");
  }
  if (!job.cancelable) return;

  if (job.status === "queued") {
    const index = queue.indexOf(jobId);
    if (index >= 0) queue.splice(index, 1);
    finalizeJob(job, "canceled");
    job.reject(new Error("Job canceled"));
    recalculateQueuePositions();
    return;
  }

  if (job.status === "running") {
    job.cancelable = false;
    emitJob(job);
    job.controller.abort();
  }
}

export async function scheduleJob<T>(options: ScheduleJobOptions<T>): Promise<T> {
  const id = `job-${nextJobId++}`;
  const createdAt = new Date().toISOString();

  const promise = new Promise<T>((resolve, reject) => {
    const job: InternalJob = {
      id,
      kind: options.kind,
      status: activeJobId ? "queued" : "running",
      title: options.title,
      subtitle: options.subtitle,
      createdAt,
      startedAt: activeJobId ? undefined : createdAt,
      endedAt: undefined,
      cancelable: true,
      queuePosition: undefined,
      runFolder: options.runFolder,
      promptIds: options.promptIds,
      provider: options.provider,
      model: options.model,
      progress: emptyProgress(),
      error: undefined,
      controller: new AbortController(),
      task: options.task as JobTask<unknown>,
      resolve: resolve as (value: unknown) => void,
      reject,
      seenSections: new Set<string>(),
    };

    jobs.set(id, job);
    emitJob(job);
    appLogger.info("Job queued", {
      jobId: id,
      runFolder: options.runFolder,
      detail: options.title,
    });

    if (activeJobId) {
      queue.push(id);
      job.status = "queued";
      recalculateQueuePositions();
    } else {
      void startJob(job);
    }
  });

  return promise;
}

export function getJobLog(jobId: string, lines: number, tailFile: (filePath: string, lines: number) => Promise<string> | string): Promise<string> | string {
  const job = jobs.get(jobId);
  if (!job) {
    throw new Error("Job not found");
  }
  if (job.runFolder) {
    const config = loadConfig();
    const logPath = resolveRunDocumentPath(job.runFolder, RUN_LOG_FILE, config);
    return tailFile(logPath, lines);
  }
  return tailFile(getAppLogPath(), lines);
}
