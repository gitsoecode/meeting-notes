import { useMemo, useState, type ReactNode } from "react";
import { Filter } from "lucide-react";
import type { JobSummary } from "../../../../shared/ipc";
import {
  CancelJobButton,
  PipelineStatus,
  outputsFromJobSteps,
  resolvePipelineStatus,
} from "../PipelineStatus";
import { Button } from "../ui/button";

interface JobsSectionProps {
  jobs: JobSummary[];
  cancelingJobId: string | null;
  onCancel: (jobId: string) => void | Promise<void>;
  onFilterLogsByJob: (job: JobSummary) => void;
  selectedJobId?: string;
}

const HISTORY_INITIAL_LIMIT = 5;

export function JobsSection({
  jobs,
  cancelingJobId,
  onCancel,
  onFilterLogsByJob,
  selectedJobId,
}: JobsSectionProps) {
  const failed = useMemo(
    () =>
      jobs
        .filter((job) => effectiveStatus(job) === "failed")
        .sort((a, b) => (b.endedAt ?? b.createdAt).localeCompare(a.endedAt ?? a.createdAt)),
    [jobs]
  );
  const running = useMemo(
    () =>
      jobs.filter((job) => {
        const s = effectiveStatus(job);
        return s === "running" || s === "processing";
      }),
    [jobs]
  );
  const queued = useMemo(
    () =>
      jobs
        .filter((job) => job.status === "queued")
        .sort((a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0)),
    [jobs]
  );
  const history = useMemo(
    () =>
      jobs
        .filter((job) => {
          const s = effectiveStatus(job);
          return s === "completed" || s === "canceled";
        })
        .sort((a, b) => (b.endedAt ?? b.createdAt).localeCompare(a.endedAt ?? a.createdAt)),
    [jobs]
  );

  const [showAllHistory, setShowAllHistory] = useState(false);
  const visibleHistory = showAllHistory ? history : history.slice(0, HISTORY_INITIAL_LIMIT);

  const isEmpty =
    failed.length === 0 && running.length === 0 && queued.length === 0 && history.length === 0;

  return (
    <section className="space-y-4" aria-label="Jobs">
      <div className="space-y-1">
        <h3 className="text-base font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
          Jobs
        </h3>
        <p className="text-sm text-[var(--text-secondary)]">
          Failed work surfaces first. Click <span className="font-medium">Filter logs</span> on any
          row to scope the log section to that job.
        </p>
      </div>

      {isEmpty ? (
        <div className="text-sm text-[var(--text-secondary)]">
          No jobs yet. Recordings, imports, and reprocesses appear here as soon as they are queued.
        </div>
      ) : (
        <div className="space-y-5">
          {failed.length > 0 ? (
            <JobGroup label="Failed" testId="jobs-group-failed">
              {failed.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  cancelingJobId={cancelingJobId}
                  onCancel={onCancel}
                  onFilterLogsByJob={onFilterLogsByJob}
                  selectedJobId={selectedJobId}
                />
              ))}
            </JobGroup>
          ) : null}

          {running.length > 0 ? (
            <JobGroup label="Running now" testId="jobs-group-running">
              {running.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  cancelingJobId={cancelingJobId}
                  onCancel={onCancel}
                  onFilterLogsByJob={onFilterLogsByJob}
                  selectedJobId={selectedJobId}
                />
              ))}
            </JobGroup>
          ) : null}

          {queued.length > 0 ? (
            <JobGroup label="Queued" testId="jobs-group-queued">
              {queued.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  cancelingJobId={cancelingJobId}
                  onCancel={onCancel}
                  onFilterLogsByJob={onFilterLogsByJob}
                  selectedJobId={selectedJobId}
                />
              ))}
            </JobGroup>
          ) : null}

          {history.length > 0 ? (
            <JobGroup label="Recent history" testId="jobs-group-history">
              {visibleHistory.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  cancelingJobId={cancelingJobId}
                  onCancel={onCancel}
                  onFilterLogsByJob={onFilterLogsByJob}
                  selectedJobId={selectedJobId}
                />
              ))}
              {!showAllHistory && history.length > HISTORY_INITIAL_LIMIT ? (
                <button
                  type="button"
                  onClick={() => setShowAllHistory(true)}
                  className="text-xs text-[var(--text-secondary)] underline-offset-2 hover:text-[var(--text-primary)] hover:underline"
                >
                  Show all ({history.length})
                </button>
              ) : null}
            </JobGroup>
          ) : null}
        </div>
      )}
    </section>
  );
}

function JobGroup({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2" data-testid={testId}>
      <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
        {label}
      </h4>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function JobRow({
  job,
  cancelingJobId,
  onCancel,
  onFilterLogsByJob,
  selectedJobId,
}: {
  job: JobSummary;
  cancelingJobId: string | null;
  onCancel: (jobId: string) => void | Promise<void>;
  onFilterLogsByJob: (job: JobSummary) => void;
  selectedJobId?: string;
}) {
  const sections = outputsFromJobSteps(job.progress.steps);
  const isSelected = selectedJobId === job.id;
  const description = `${job.subtitle}${job.model ? ` · ${job.model}` : ""}${
    job.error ? ` · ${job.error}` : ""
  }`;

  return (
    <PipelineStatus
      sections={sections}
      title={job.title}
      description={description}
      status={resolvePipelineStatus(job.status, sections)}
      queuePosition={job.queuePosition}
      currentLabel={job.progress.currentOutputLabel}
      showPreparingWhenEmpty={job.status === "running" || job.status === "queued"}
      compact
      action={
        <div className="flex items-center gap-2" data-testid={`job-row-${job.id}`}>
          <Button
            variant={isSelected ? "secondary" : "ghost"}
            size="sm"
            aria-label={`Filter logs for ${job.title}`}
            data-testid={`job-row-filter-${job.id}`}
            onClick={(event) => {
              event.stopPropagation();
              onFilterLogsByJob(job);
            }}
          >
            <Filter className="h-3.5 w-3.5" />
            Filter logs
          </Button>
          {job.cancelable ? (
            <CancelJobButton
              jobId={job.id}
              disabled={cancelingJobId === job.id}
              onCancel={onCancel}
            />
          ) : null}
        </div>
      }
    />
  );
}

function effectiveStatus(job: JobSummary) {
  return resolvePipelineStatus(job.status, outputsFromJobSteps(job.progress.steps));
}
