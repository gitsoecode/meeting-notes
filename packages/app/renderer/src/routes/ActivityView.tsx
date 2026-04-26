import { useCallback, useEffect, useState } from "react";
import { api } from "../ipc-client";
import type { AppLogEntry, JobSummary, OllamaRuntimeDTO } from "../../../shared/ipc";
import { PageIntro, PageScaffold } from "../components/PageScaffold";
import { Separator } from "../components/ui/separator";
import { RuntimeSection } from "../components/activity/RuntimeSection";
import { JobsSection } from "../components/activity/JobsSection";
import { LogsSection, type LogScope } from "../components/activity/LogsSection";

const RUNTIME_POLL_MS = 5000;
const APP_LOG_LIMIT = 400;

export function ActivityView() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [runtime, setRuntime] = useState<OllamaRuntimeDTO | null>(null);
  const [appEntries, setAppEntries] = useState<AppLogEntry[]>([]);
  const [scope, setScope] = useState<LogScope>({ kind: "app" });
  const [jobLogText, setJobLogText] = useState("");
  const [follow, setFollow] = useState(true);
  const [cancelingJobId, setCancelingJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  const refreshJobs = useCallback(async () => {
    try {
      const allJobs = await api.jobs.list();
      setJobs(
        [...allJobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const refreshAppEntries = useCallback(async () => {
    try {
      const entries = await api.logs.listAppEntries({ limit: APP_LOG_LIMIT });
      setAppEntries(entries);
      setLastUpdatedAt(new Date().toISOString());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const refreshRuntime = useCallback(async () => {
    try {
      const next = await api.llm.runtime();
      setRuntime(next);
    } catch {
      // best effort — error already surfaces in `runtime.error`
    }
  }, []);

  const refreshJobLog = useCallback(async (jobId: string) => {
    try {
      const text = await api.jobs.tailLog(jobId, APP_LOG_LIMIT);
      setJobLogText(text);
      setLastUpdatedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refreshJobs();
    void refreshAppEntries();
    void refreshRuntime();

    const onFocus = () => {
      void refreshJobs();
      void refreshAppEntries();
      void refreshRuntime();
    };
    window.addEventListener("focus", onFocus);

    const unsubJob = api.on.jobUpdate((job) => {
      setJobs((prev) => {
        const next = new Map(prev.map((item) => [item.id, item]));
        next.set(job.id, job);
        return [...next.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      });
    });

    const unsubLog = api.on.logEntry((entry) => {
      setAppEntries((prev) => [entry, ...prev].slice(0, APP_LOG_LIMIT));
      setLastUpdatedAt(new Date().toISOString());
    });

    const runtimeId = window.setInterval(() => {
      void refreshRuntime();
    }, RUNTIME_POLL_MS);

    return () => {
      window.removeEventListener("focus", onFocus);
      unsubJob();
      unsubLog();
      window.clearInterval(runtimeId);
    };
  }, [refreshAppEntries, refreshJobs, refreshRuntime]);

  useEffect(() => {
    if (scope.kind !== "job-file") {
      setJobLogText("");
      return;
    }
    void refreshJobLog(scope.jobId);
  }, [scope, refreshJobLog]);

  const onCancelJob = useCallback(async (jobId: string) => {
    setCancelingJobId(jobId);
    try {
      await api.jobs.cancel(jobId);
    } finally {
      setCancelingJobId((current) => (current === jobId ? null : current));
    }
  }, []);

  const onFilterLogsByJob = useCallback((job: JobSummary) => {
    setScope({ kind: "job-events", jobId: job.id, title: job.title });
  }, []);

  const onScopeChange = useCallback((next: LogScope) => {
    setScope(next);
  }, []);

  const onRefreshAll = useCallback(() => {
    void refreshJobs();
    void refreshAppEntries();
    void refreshRuntime();
    if (scope.kind === "job-file") {
      void refreshJobLog(scope.jobId);
    }
  }, [refreshAppEntries, refreshJobLog, refreshJobs, refreshRuntime, scope]);

  const selectedJob =
    scope.kind === "app"
      ? null
      : jobs.find((job) => job.id === scope.jobId) ?? null;

  return (
    <PageScaffold>
      <PageIntro
        title="Activity"
        description="Local operations console: engine health, the job queue, and structured logs."
      />

      {error ? (
        <div className="rounded-md border border-[var(--error)]/20 bg-[var(--error-muted)] px-3 py-2 text-sm text-[var(--error)]">
          {error}
        </div>
      ) : null}

      <RuntimeSection
        runtime={runtime}
        onRefresh={() => void refreshRuntime()}
        onRevealOllamaLog={() => void api.logs.revealOllama()}
      />

      <Separator />

      <JobsSection
        jobs={jobs}
        cancelingJobId={cancelingJobId}
        onCancel={onCancelJob}
        onFilterLogsByJob={onFilterLogsByJob}
        selectedJobId={scope.kind === "app" ? undefined : scope.jobId}
      />

      <Separator />

      <LogsSection
        appEntries={appEntries}
        jobLogText={jobLogText}
        scope={scope}
        selectedJob={selectedJob}
        onScopeChange={onScopeChange}
        follow={follow}
        onFollowChange={setFollow}
        onRevealAppLog={() => void api.logs.revealApp()}
        onRefresh={onRefreshAll}
        lastUpdatedAt={lastUpdatedAt}
      />
    </PageScaffold>
  );
}
