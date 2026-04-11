import { useEffect, useMemo, useState } from "react";
import { FileUp, PlayCircle } from "lucide-react";
import { api } from "../ipc-client";
import type { BulkReprocessResult, JobSummary, PromptRow, RunSummary } from "../../../shared/ipc";
import { PageScaffold } from "../components/PageScaffold";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { ProcessingStatusInline } from "../components/PipelineStatus";
import { PromptRunSummary } from "../components/PromptRunSummary";
import { Spinner } from "../components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { relativeDateLabel } from "../constants";
import { getDefaultPromptModel } from "../lib/prompt-metadata";

interface MeetingsListProps {
  onOpen: (runFolder: string) => void;
  onOpenPrep?: (runFolder: string) => void;
}

export function MeetingsList({ onOpen, onOpenPrep }: MeetingsListProps) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [defaultPromptModel, setDefaultPromptModel] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobSummary[]>([]);

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await api.runs.list();
      setRuns(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    api.jobs.list().then(setJobs).catch(() => {});
    api.config
      .get()
      .then((config) => setDefaultPromptModel(getDefaultPromptModel(config)))
      .catch(() => setDefaultPromptModel(null));
    const unsub = api.on.jobUpdate((job) => {
      setJobs((prev) => {
        const next = new Map(prev.map((item) => [item.id, item]));
        next.set(job.id, job);
        return [...next.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      });
    });
    return () => unsub();
  }, []);

  // Poll for updates when any meeting is processing
  useEffect(() => {
    const hasProcessing = runs.some((run) => run.status === "processing");
    if (!hasProcessing) return;
    const id = setInterval(() => {
      api.runs.list().then(setRuns).catch(() => {});
    }, 10000);
    return () => clearInterval(id);
  }, [runs]);

  const toggleSelected = (folder: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
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

  const onImport = async () => {
    setImporting(true);
    try {
      const picked = await api.config.pickMediaFile();
      if (!picked) return;
      const result = await api.runs.processMedia(
        picked.token,
        deriveMeetingTitle(picked.name)
      );
      await refresh();
      onOpen(result.run_folder);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const onImportDropped = async (file: File) => {
    setImporting(true);
    try {
      const result = await api.runs.processDroppedMedia(file, deriveMeetingTitle(file.name));
      await refresh();
      onOpen(result.run_folder);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const filteredRuns = useMemo(() => {
    const query = search.trim().toLowerCase();
    const base = [...runs].sort(
      (a, b) =>
        (Date.parse(b.started || b.date) || 0) - (Date.parse(a.started || a.date) || 0)
    );
    if (!query) return base;
    return base.filter((run) => {
      const haystack = [run.title, run.description ?? "", run.status].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [runs, search]);

  const activeJobsByRunFolder = useMemo(() => {
    const map = new Map<string, JobSummary>();
    for (const job of jobs) {
      if (!job.runFolder) continue;
      if (!["queued", "running"].includes(job.status)) continue;
      map.set(job.runFolder, job);
    }
    return map;
  }, [jobs]);

  const allVisibleSelected =
    filteredRuns.length > 0 && filteredRuns.every((run) => selected.has(run.folder_path));

  const toggleAllVisible = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        filteredRuns.forEach((run) => next.add(run.folder_path));
      } else {
        filteredRuns.forEach((run) => next.delete(run.folder_path));
      }
      return next;
    });
  };

  return (
    <PageScaffold
      className="gap-4 md:gap-5"
      onDragOver={(event) => {
        if (importing || event.dataTransfer.files.length === 0) return;
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragActive(false);
        }
      }}
      onDrop={(event) => {
        if (importing) return;
        event.preventDefault();
        setDragActive(false);
        const file = event.dataTransfer.files?.[0];
        if (!file) return;
        void onImportDropped(file);
      }}
    >
      {error ? (
        <div className="rounded-lg border border-[var(--error)]/20 bg-[var(--error-muted)] px-4 py-3 text-sm text-[var(--error)]">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search meetings…"
          className="w-full sm:max-w-sm"
        />
        <span className="text-xs text-[var(--text-tertiary)]">{runs.length} meetings</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={onImport} disabled={importing}>
            {importing ? (
              <>
                <Spinner />
                Importing…
              </>
            ) : (
              <>
                <FileUp className="h-4 w-4" />
                Import meeting
              </>
            )}
          </Button>
          {selected.size > 0 ? (
            <Button onClick={() => setBulkOpen(true)}>
              <PlayCircle className="h-4 w-4" />
              Run prompt on {selected.size}
            </Button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <Spinner className="h-3.5 w-3.5" />
          Loading…
        </div>
      ) : filteredRuns.length === 0 ? (
        <div
          className={`rounded-lg border border-dashed p-4 md:p-6 text-sm ${
            dragActive
              ? "border-[var(--accent)] bg-[rgba(45,107,63,0.08)]"
              : "border-[var(--border-strong)] bg-white"
          }`}
        >
          <div className="font-semibold text-[var(--text-primary)]">No meetings yet</div>
          <div className="mt-1 text-[var(--text-secondary)]">
            Start a recording from Home, or drop a file here to import.
          </div>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-[var(--border-default)] bg-white shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="bg-[var(--bg-secondary)] hover:bg-[var(--bg-secondary)]">
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label="Select all"
                      checked={allVisibleSelected}
                      onCheckedChange={(checked) => toggleAllVisible(!!checked)}
                    />
                  </TableHead>
                  <TableHead>Meeting</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRuns.map((run) => (
                  (() => {
                    const activeJob = activeJobsByRunFolder.get(run.folder_path);
                    return (
                      <TableRow
                        key={run.folder_path}
                        data-state={selected.has(run.folder_path) ? "selected" : undefined}
                        className="cursor-pointer"
                        onClick={() => run.status === "draft" && onOpenPrep ? onOpenPrep(run.folder_path) : onOpen(run.folder_path)}
                      >
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            aria-label={`Select ${run.title}`}
                            checked={selected.has(run.folder_path)}
                            onCheckedChange={() => toggleSelected(run.folder_path)}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                            {run.title}
                          </div>
                          {run.description && (
                            <div className="mt-0.5 line-clamp-1 text-xs text-[var(--text-secondary)]">
                              {run.description}
                            </div>
                          )}
                          {activeJob ? (
                            <div className="mt-1">
                              <ProcessingStatusInline
                                status={activeJob.status === "running" ? "processing" : activeJob.status}
                                currentLabel={
                                  activeJob.progress.currentSectionLabel ??
                                  (activeJob.status === "queued"
                                    ? `Queued${activeJob.queuePosition ? ` · #${activeJob.queuePosition}` : ""}`
                                    : undefined)
                                }
                              />
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-sm text-[var(--text-secondary)]">
                          {relativeDateLabel(run.started || run.date)}
                        </TableCell>
                        <TableCell className="text-sm text-[var(--text-secondary)]">
                          {run.duration_minutes != null ? `${run.duration_minutes.toFixed(1)}m` : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              run.status === "complete"
                                ? "success"
                                : run.status === "processing"
                                ? "info"
                                : run.status === "error"
                                ? "destructive"
                                : "warning"
                            }
                            className={activeJob ? "gap-1" : undefined}
                          >
                            {activeJob?.status === "running" ? <Spinner className="h-3 w-3" /> : null}
                            {run.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })()
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {filteredRuns.map((run) => (
              (() => {
                const activeJob = activeJobsByRunFolder.get(run.folder_path);
                return (
                  <button
                    key={run.folder_path}
                    type="button"
                    onClick={() => onOpen(run.folder_path)}
                    className="w-full rounded-lg border border-[var(--border-default)] bg-white p-3 text-left shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-[var(--text-primary)]">{run.title}</span>
                      <Badge
                        variant={
                          run.status === "complete" ? "success"
                            : run.status === "processing" ? "info"
                            : run.status === "error" ? "destructive"
                            : "warning"
                        }
                        className={activeJob ? "gap-1" : undefined}
                      >
                        {activeJob?.status === "running" ? <Spinner className="h-3 w-3" /> : null}
                        {run.status}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-[var(--text-secondary)]">
                      {relativeDateLabel(run.started || run.date)}
                      {run.duration_minutes != null ? ` · ${run.duration_minutes.toFixed(1)}m` : ""}
                    </div>
                    {activeJob ? (
                      <div className="mt-2">
                        <ProcessingStatusInline
                          status={activeJob.status === "running" ? "processing" : activeJob.status}
                          currentLabel={activeJob.progress.currentSectionLabel}
                        />
                      </div>
                    ) : null}
                  </button>
                );
              })()
            ))}
          </div>
        </>
      )}

      {bulkOpen ? (
        <BulkRunPromptModal
          runs={runs
            .filter((run) => selected.has(run.folder_path))
            .map((run) => ({ runFolder: run.folder_path, title: run.title }))}
          defaultModel={defaultPromptModel}
          onClose={() => setBulkOpen(false)}
          onDone={() => {
            setBulkOpen(false);
            setSelected(new Set());
            void refresh();
          }}
        />
      ) : null}
    </PageScaffold>
  );
}

interface BulkRunPromptModalProps {
  runs: Array<{ runFolder: string; title: string }>;
  defaultModel: string | null;
  onClose: () => void;
  onDone: () => void;
}

function BulkRunPromptModal({ runs, defaultModel, onClose, onDone }: BulkRunPromptModalProps) {
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<BulkReprocessResult[] | null>(null);
  const selectedPrompt = prompts.find((prompt) => prompt.id === selectedPromptId) ?? null;

  useEffect(() => {
    api.prompts.list().then((list) => {
      setPrompts(list);
      if (list.length > 0) setSelectedPromptId(list[0].id);
    });
  }, []);

  const onRun = async () => {
    if (!selectedPromptId) return;
    setRunning(true);
    try {
      const response = await api.runs.bulkReprocess({
        runFolders: runs.map((run) => run.runFolder),
        onlyIds: [selectedPromptId],
      });
      setResults(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const completedCount = results?.filter((result) => !result.error).length ?? 0;
  const failedCount = results?.filter((result) => result.error).length ?? 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Run prompt on {runs.length} meetings</DialogTitle>
          <DialogDescription>
            Kick off the same analysis prompt across selected meetings without reopening each
            one individually.
          </DialogDescription>
        </DialogHeader>

        {!results ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--text-secondary)]">Prompt</label>
              <Select value={selectedPromptId} onValueChange={setSelectedPromptId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a prompt" />
                </SelectTrigger>
                <SelectContent>
                {prompts.map((prompt) => (
                  <SelectItem key={prompt.id} value={prompt.id}>
                    {prompt.label} {prompt.auto ? "(auto-run)" : "(manual)"}
                  </SelectItem>
                ))}
                </SelectContent>
              </Select>
            </div>

            <PromptRunSummary prompt={selectedPrompt} defaultModel={defaultModel} />

            <div className="max-h-52 overflow-auto rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
              <div className="space-y-2">
                {runs.map((run) => (
                  <div
                    key={run.runFolder}
                    className="rounded-lg border border-[var(--border-default)] bg-white px-4 py-3 text-sm text-[var(--text-primary)]"
                  >
                    {run.title}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm text-[var(--text-secondary)]">
              Completed {completedCount} meeting{completedCount === 1 ? "" : "s"}
              {failedCount > 0 ? `, ${failedCount} failed.` : "."}
            </div>
            <div className="max-h-60 space-y-3 overflow-auto">
              {results.map((result) => {
                const run = runs.find((item) => item.runFolder === result.runFolder);
                return (
                  <div
                    key={result.runFolder}
                    className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="text-sm font-semibold text-[var(--text-primary)]">
                        {run?.title ?? result.runFolder}
                      </div>
                      <Badge variant={result.error ? "destructive" : "success"}>
                        {result.error ? "failed" : "complete"}
                      </Badge>
                    </div>
                    <div className="mt-2 text-sm text-[var(--text-secondary)]">
                      {result.error
                        ? result.error
                        : `${result.succeeded.length} prompt section${result.succeeded.length === 1 ? "" : "s"} completed`}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {error ? <div className="text-sm text-[var(--error)]">{error}</div> : null}

        <DialogFooter>
          <Button variant="secondary" onClick={results ? onDone : onClose} disabled={running}>
            {results ? "Done" : "Cancel"}
          </Button>
          {!results ? (
            <Button onClick={onRun} disabled={running || !selectedPromptId}>
              {running ? (
                <>
                  <Spinner />
                  Running…
                </>
              ) : (
                "Run"
              )}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
