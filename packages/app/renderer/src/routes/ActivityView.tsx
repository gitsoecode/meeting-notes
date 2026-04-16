import { useEffect, useMemo, useState } from "react";
import { Cpu, FileText } from "lucide-react";
import { api } from "../ipc-client";
import type {
  ActivityProcess,
  AppLogEntry,
  AppLogLevel,
  JobSummary,
  OllamaRuntimeDTO,
} from "../../../shared/ipc";
import {
  CancelJobButton,
  PipelineStatus,
  resolvePipelineStatus,
  outputsFromJobSteps,
} from "../components/PipelineStatus";
import { PageIntro, PageScaffold } from "../components/PageScaffold";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { StackedMeter } from "../components/ui/meter";
import { cn } from "../lib/utils";

type LogSource = { kind: "app" } | { kind: "job"; jobId: string };
type SeverityFilter = "all" | "error" | "warn" | "info";

interface DisplayLogEntry {
  id: string;
  timestamp?: string;
  level?: AppLogLevel;
  component?: string;
  message: string;
  detail?: string;
  raw: string;
}

export function ActivityView() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [runtime, setRuntime] = useState<OllamaRuntimeDTO | null>(null);
  const [source, setSource] = useState<LogSource>({ kind: "app" });
  const [rawContent, setRawContent] = useState("");
  const [appEntries, setAppEntries] = useState<AppLogEntry[]>([]);
  const [processes, setProcesses] = useState<ActivityProcess[]>([]);
  const [follow, setFollow] = useState(true);
  const [appPath, setAppPath] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [cancelingJobId, setCancelingJobId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  const refreshJobs = () =>
    api.jobs.list().then((allJobs) => {
      setJobs(allJobs);
      return allJobs;
    });

  const refreshLogs = async (selectedSource: LogSource) => {
    try {
      if (selectedSource.kind === "app") {
        const [entries, text] = await Promise.all([
          api.logs.listAppEntries({ limit: 400 }),
          api.logs.tailApp(400),
        ]);
        setAppEntries(entries);
        setRawContent(text);
      } else {
        const text = await api.jobs.tailLog(selectedSource.jobId, 400);
        setRawContent(text);
      }
      setLastUpdatedAt(new Date().toISOString());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void refreshJobs().catch(() => {});
    api.logs.appPath().then(setAppPath).catch(() => {});
    api.llm.runtime().then(setRuntime).catch(() => {});
    api.logs.listProcesses().then(setProcesses).catch(() => {});
    void refreshLogs({ kind: "app" });

    const unsubJob = api.on.jobUpdate((job) => {
      setJobs((prev) => {
        const next = new Map(prev.map((item) => [item.id, item]));
        next.set(job.id, job);
        return [...next.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      });
    });

    const unsubLog = api.on.logEntry((entry) => {
      setAppEntries((prev) => [entry, ...prev].slice(0, 400));
      if (follow && source.kind === "app") {
        void api.logs.tailApp(400).then(setRawContent).catch(() => {});
        setLastUpdatedAt(new Date().toISOString());
      }
    });

    const unsubProcess = api.on.processUpdate((process) => {
      setProcesses((prev) => {
        const next = new Map(prev.map((item) => [item.id, item]));
        next.set(process.id, process);
        return [...next.values()].sort(compareProcesses);
      });
    });

    const runtimeId = window.setInterval(() => {
      api.llm.runtime().then(setRuntime).catch(() => {});
    }, 5000);
    const jobsId = window.setInterval(() => {
      void refreshJobs().catch(() => {});
    }, 3000);

    return () => {
      unsubJob();
      unsubLog();
      unsubProcess();
      clearInterval(runtimeId);
      clearInterval(jobsId);
    };
  }, [follow, source.kind]);

  useEffect(() => {
    void refreshLogs(source);
    if (!follow) return;
    const id = window.setInterval(() => {
      void refreshLogs(source);
    }, 2000);
    return () => clearInterval(id);
  }, [follow, source]);

  const runningJobs = useMemo(
    () =>
      jobs.filter(
        (job) => resolvePipelineStatus(job.status, outputsFromJobSteps(job.progress.steps)) === "running"
      ),
    [jobs]
  );
  const queuedJobs = useMemo(
    () => jobs.filter((job) => job.status === "queued").sort((a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0)),
    [jobs]
  );
  const completedJobs = useMemo(
    () =>
      jobs.filter((job) =>
        ["completed", "failed", "canceled"].includes(
          resolvePipelineStatus(job.status, outputsFromJobSteps(job.progress.steps))
        )
      ),
    [jobs]
  );
  const activeLocalJobs = runningJobs.filter((job) => job.provider === "ollama");
  const orderedJobs = useMemo(() => [...runningJobs, ...queuedJobs, ...completedJobs], [completedJobs, queuedJobs, runningJobs]);
  const selectedJob = source.kind === "job" ? jobs.find((job) => job.id === source.jobId) ?? null : null;

  const logOptions = [
    { value: "__app__", label: "App log" },
    ...jobs.map((job) => ({
      value: job.id,
      label: `${job.title} · ${job.status}`,
    })),
  ];

  const entries = useMemo<DisplayLogEntry[]>(() => {
    if (source.kind === "app") {
      return appEntries
        .slice()
        .reverse()
        .map((entry) => ({
          id: entry.id,
          timestamp: entry.timestamp,
          level: entry.level,
          component: entry.component,
          message: entry.message,
          detail: entry.detail ?? entry.stack,
          raw: formatRawLineFromEntry(entry),
        }));
    }
    return parseRawLogLines(rawContent);
  }, [appEntries, rawContent, source.kind]);

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      const level = entry.level ?? "info";
      if (onlyErrors && level !== "error") return false;
      if (severity !== "all" && level !== severity) return false;
      if (!searchTerm.trim()) return true;
      const haystack = [entry.raw, entry.detail, entry.message, entry.component]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(searchTerm.toLowerCase());
    });
  }, [entries, onlyErrors, searchTerm, severity]);

  const errorCount = filteredEntries.filter((entry) => (entry.level ?? "info") === "error").length;
  const relevantProcesses = useMemo(() => {
    const active = processes.filter((process) => process.status === "running" || process.status === "starting");
    if (source.kind === "app") return active;
    const runFolder = selectedJob?.runFolder;
    return active.filter((process) => process.runFolder === runFolder || process.jobId === selectedJob?.id);
  }, [processes, selectedJob, source.kind]);

  const onCancelJob = async (jobId: string) => {
    setCancelingJobId(jobId);
    try {
      await api.jobs.cancel(jobId);
    } finally {
      setCancelingJobId((current) => (current === jobId ? null : current));
    }
  };

  return (
    <PageScaffold>
      <PageIntro
        badge="Background work"
        title="Activity"
        description="Monitor processing jobs, cancel work that is consuming resources, and inspect logs when you need more detail."
      />

      {activeLocalJobs.length > 0 ? (
        <div className="rounded-lg border border-[var(--accent)]/20 bg-[rgba(45,107,63,0.08)] px-4 py-3 text-sm text-[var(--text-primary)]">
          Local processing is active. Cancel running jobs here if Ollama is consuming too much CPU, GPU, or memory.
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="p-6">
          <CardHeader>
            <div className="space-y-2">
              <CardTitle className="text-xl">Jobs</CardTitle>
              <CardDescription>
                Running, queued, and recent completed work in one place.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {orderedJobs.length === 0 ? (
              <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-4 text-sm text-[var(--text-secondary)]">
                No jobs yet. New recording, import, and reprocess work should appear here as soon as it is queued.
              </div>
            ) : (
              <div className="space-y-5">
                {runningJobs.length > 0 ? (
                  <div className="space-y-3">
                    <div className="text-sm font-semibold text-[var(--text-primary)]">Running now</div>
                    {runningJobs.map((job) => (
                      <PipelineStatus
                        key={job.id}
                        sections={outputsFromJobSteps(job.progress.steps)}
                        title={job.title}
                        description={`${job.subtitle}${job.model ? ` · ${job.model}` : ""}`}
                        status={resolvePipelineStatus(job.status, outputsFromJobSteps(job.progress.steps))}
                        currentLabel={job.progress.currentOutputLabel}
                        showPreparingWhenEmpty
                        compact
                        action={
                          job.cancelable ? (
                            <CancelJobButton
                              jobId={job.id}
                              disabled={cancelingJobId === job.id}
                              onCancel={onCancelJob}
                            />
                          ) : undefined
                        }
                      />
                    ))}
                  </div>
                ) : null}

                {queuedJobs.length > 0 ? (
                  <div className="space-y-3">
                    <div className="text-sm font-semibold text-[var(--text-primary)]">Queued jobs</div>
                    {queuedJobs.map((job) => (
                      <PipelineStatus
                        key={job.id}
                        sections={outputsFromJobSteps(job.progress.steps)}
                        title={job.title}
                        description={`${job.subtitle}${job.error ? ` · ${job.error}` : ""}`}
                        status={job.status}
                        queuePosition={job.queuePosition}
                        currentLabel={job.progress.currentOutputLabel}
                        showPreparingWhenEmpty
                        compact
                        action={
                          job.cancelable ? (
                            <CancelJobButton
                              jobId={job.id}
                              disabled={cancelingJobId === job.id}
                              onCancel={onCancelJob}
                            />
                          ) : undefined
                        }
                      />
                    ))}
                  </div>
                ) : null}

                {completedJobs.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-sm font-semibold text-[var(--text-primary)]">Recent history</div>
                    {completedJobs.map((job) => (
                      <PipelineStatus
                        key={job.id}
                        sections={outputsFromJobSteps(job.progress.steps)}
                        title={job.title}
                        description={`${job.subtitle}${job.error ? ` · ${job.error}` : ""}`}
                        status={resolvePipelineStatus(job.status, outputsFromJobSteps(job.progress.steps))}
                        currentLabel={job.progress.currentOutputLabel}
                        compact
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card className="p-6">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <CardTitle className="text-lg">Ollama</CardTitle>
                  <CardDescription>Loaded local models and memory use.</CardDescription>
                </div>
                <Cpu className="h-5 w-5 text-[var(--accent)]" />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {!runtime?.available ? (
                <div className="text-sm text-[var(--text-secondary)]">
                  {runtime?.error ?? "Runtime information is unavailable."}
                </div>
              ) : runtime.models.length === 0 ? (
                <div className="text-sm text-[var(--text-secondary)]">
                  No models are currently loaded.
                </div>
              ) : (
                runtime.models.map((model) => (
                  <div
                    key={`${model.model}-${model.expires_at ?? "loaded"}`}
                    className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-3"
                  >
                    <div className="text-sm font-medium text-[var(--text-primary)]">
                      {model.name ?? model.model}
                    </div>
                    <div className="mt-1 text-xs text-[var(--text-secondary)]">
                      {model.details?.parameter_size ?? "Unknown size"} · {model.details?.quantization_level ?? "Unknown quantization"}
                    </div>
                    <div className="mt-2 text-xs text-[var(--text-secondary)]">
                      {formatBytes(model.size_vram)} / {formatBytes(model.size)} · Expires {formatDateTime(model.expires_at)}
                    </div>
                  </div>
                ))
              )}
              {runtime?.systemMemory ? <MemoryMeter memory={runtime.systemMemory} /> : null}
            </CardContent>
          </Card>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-[var(--error)]/20 bg-[var(--error-muted)] px-4 py-3 text-sm text-[var(--error)]">
          {error}
        </div>
      ) : null}

      <Card className="p-6">
        <CardHeader>
          <div className="space-y-2">
            <Badge variant="neutral" className="w-fit">
              Logs
            </Badge>
            <CardTitle className="text-xl">Inspect raw output</CardTitle>
            <CardDescription>
              {source.kind === "app" ? appPath || "~/.meeting-notes/app.log" : "Run log for the selected job."}
            </CardDescription>
          </div>
          <div className="hidden rounded-lg bg-[linear-gradient(180deg,rgba(45,107,63,0.12),rgba(45,107,63,0.03))] p-4 md:block">
            <FileText className="h-5 w-5 text-[var(--accent)]" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(200px,1fr)_180px_180px]">
            <Select
              value={source.kind === "app" ? "__app__" : source.jobId}
              onValueChange={(value) => {
                if (value === "__app__") setSource({ kind: "app" });
                else setSource({ kind: "job", jobId: value });
              }}
            >
              <SelectTrigger aria-label="Log source">
                <SelectValue placeholder="Select a log source…" />
              </SelectTrigger>
              <SelectContent>
                {logOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex h-9 items-center rounded-md border border-[var(--border-default)] bg-white px-3 shadow-sm focus-within:ring-2 focus-within:ring-[var(--ring)] focus-within:ring-offset-2 focus-within:ring-offset-[var(--bg-primary)]">
              <input
                aria-label="Search logs"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search logs"
                className="h-full w-full border-0 bg-transparent p-0 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
              />
            </div>

            <Select value={severity} onValueChange={(value) => setSeverity(value as SeverityFilter)}>
              <SelectTrigger aria-label="Severity filter">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="error">Errors</SelectItem>
                <SelectItem value="warn">Warnings</SelectItem>
                <SelectItem value="info">Info</SelectItem>
              </SelectContent>
            </Select>

            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-[var(--text-primary)]">Follow</div>
                  <div className="text-xs text-[var(--text-secondary)]">2s refresh</div>
                </div>
                <Switch aria-label="Follow logs" checked={follow} onCheckedChange={setFollow} />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setOnlyErrors((current) => !current)}
              className={cn(
                "rounded-full border px-3 py-1.5 transition-colors",
                onlyErrors
                  ? "border-[var(--error)]/30 bg-[var(--error-muted)] text-[var(--error)]"
                  : "border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
              )}
            >
              Only errors
            </button>
            <div className="rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1.5 text-[var(--text-secondary)]">
              {errorCount} error{errorCount === 1 ? "" : "s"} in view
            </div>
            <div className="rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1.5 text-[var(--text-secondary)]">
              Updated {lastUpdatedAt ? formatRelativeTime(lastUpdatedAt) : "just now"}
            </div>
            <div className="rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1.5 text-[var(--text-secondary)]">
              {source.kind === "app" ? "app-events + app.log" : selectedJob?.title ?? "job log"}
            </div>
            {relevantProcesses.map((process) => (
              <div
                key={process.id}
                className="rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1.5 text-[var(--text-secondary)]"
              >
                {process.label} · pid {process.pid ?? "—"}
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--text-primary)] shadow-sm">
            <div className="border-b border-white/10 px-4 py-2 text-[11px] uppercase tracking-[0.12em] text-[rgba(255,255,255,0.55)]">
              CLI log view
            </div>
            <div className="max-h-[36rem] overflow-auto px-4 py-3 font-mono text-xs leading-6 text-[rgba(255,255,255,0.86)]">
              {filteredEntries.length === 0 ? (
                <div className="text-[rgba(255,255,255,0.45)]">(no matching log lines)</div>
              ) : (
                filteredEntries.map((entry) => (
                  <div key={entry.id} className="border-b border-white/5 py-1 last:border-b-0">
                    <div className="whitespace-pre-wrap break-words">
                      {renderLogPrefix(entry)}
                      <span className={lineClassForLevel(entry.level)}>{entry.message}</span>
                    </div>
                    {entry.detail ? (
                      <div className="pl-6 text-[rgba(255,255,255,0.55)]">{entry.detail}</div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </PageScaffold>
  );
}

function parseRawLogLines(content: string): DisplayLogEntry[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line, index) => {
      const match = line.match(/^\[(.+?)\]\s+([A-Z]+)\s+\[(.+?)\]\s+(.*)$/);
      if (!match) {
        return {
          id: `raw-${index}`,
          message: line,
          raw: line,
        };
      }

      const [, timestamp, upperLevel, component, remainder] = match;
      return {
        id: `raw-${timestamp}-${index}`,
        timestamp,
        level: normalizeLevel(upperLevel),
        component,
        message: remainder,
        raw: line,
      };
    });
}

function normalizeLevel(level: string): AppLogLevel {
  switch (level.toLowerCase()) {
    case "error":
      return "error";
    case "warn":
      return "warn";
    case "debug":
      return "debug";
    default:
      return "info";
  }
}

function renderLogPrefix(entry: DisplayLogEntry) {
  const parts = [
    entry.timestamp ? `[${formatTime(entry.timestamp)}]` : null,
    entry.level ? entry.level.toUpperCase().padEnd(5) : null,
    entry.component ? `[${entry.component}]` : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return <span className="text-[rgba(255,255,255,0.45)]">{parts.join(" ")} </span>;
}

function lineClassForLevel(level?: AppLogLevel): string {
  switch (level) {
    case "error":
      return "text-[rgba(255,140,140,0.98)]";
    case "warn":
      return "text-[rgba(255,219,120,0.98)]";
    case "debug":
      return "text-[rgba(173,216,255,0.92)]";
    default:
      return "text-[rgba(255,255,255,0.88)]";
  }
}

function compareProcesses(left: ActivityProcess, right: ActivityProcess): number {
  const leftWeight = left.status === "running" || left.status === "starting" ? 0 : 1;
  const rightWeight = right.status === "running" || right.status === "starting" ? 0 : 1;
  if (leftWeight !== rightWeight) return leftWeight - rightWeight;
  return right.startedAt.localeCompare(left.startedAt);
}

function formatRawLineFromEntry(entry: AppLogEntry): string {
  const base = `[${entry.timestamp}] ${entry.level.toUpperCase().padEnd(5)} [${entry.component}] ${entry.message}`;
  if (entry.data && Object.keys(entry.data).length > 0) {
    return `${base} ${JSON.stringify(entry.data)}`;
  }
  return base;
}

function formatBytes(value?: number): string {
  if (value == null || !Number.isFinite(value)) return "Unknown";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDateTime(value?: string): string {
  if (!value) return "Unknown";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  return new Date(time).toLocaleString();
}

function formatRelativeTime(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  const diffMs = Date.now() - time;
  if (diffMs < 1000) return "just now";
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  return `${diffHours}h ago`;
}

function formatTime(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  return new Date(time).toLocaleTimeString();
}

function MemoryMeter({ memory }: { memory: { totalBytes: number; freeBytes: number; ollamaVramBytes: number } }) {
  const totalGb = memory.totalBytes / (1024 ** 3);
  const usedGb = (memory.totalBytes - memory.freeBytes) / (1024 ** 3);
  const ollamaGb = memory.ollamaVramBytes / (1024 ** 3);
  const otherGb = Math.max(0, usedGb - ollamaGb);
  const usedPct = totalGb > 0 ? (usedGb / totalGb) * 100 : 0;
  const variant: "default" | "warning" | "danger" =
    usedPct > 90 ? "danger" : usedPct > 75 ? "warning" : "default";
  const ollamaColor =
    variant === "danger"
      ? "var(--error, #ef4444)"
      : variant === "warning"
        ? "var(--warning, #f59e0b)"
        : "var(--accent, #2d6b3f)";

  const segments = [];
  if (ollamaGb > 0) {
    segments.push({ value: ollamaGb, color: ollamaColor, label: `Ollama ${ollamaGb.toFixed(1)} GB` });
  }
  segments.push({ value: otherGb, color: "#3b82f6", label: `Other ${otherGb.toFixed(1)} GB` });

  return (
    <StackedMeter
      size="sm"
      max={totalGb}
      label="Memory"
      valueLabel={`${usedGb.toFixed(1)} / ${totalGb.toFixed(0)} GB used`}
      segments={segments}
    />
  );
}
