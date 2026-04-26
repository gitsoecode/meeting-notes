import { useEffect, useMemo, useRef, useState } from "react";
import { FolderOpen, X } from "lucide-react";
import type { AppLogEntry, AppLogLevel, JobSummary } from "../../../../shared/ipc";
import { Switch } from "../ui/switch";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { LogRow, type DisplayLogEntry, isExpandable } from "./LogRow";

export type LogScope =
  | { kind: "app" }
  | { kind: "job-events"; jobId: string; title: string }
  | { kind: "job-file"; jobId: string; title: string };

interface LogsSectionProps {
  appEntries: AppLogEntry[];
  jobLogText: string;
  scope: LogScope;
  selectedJob: JobSummary | null;
  onScopeChange: (scope: LogScope) => void;
  follow: boolean;
  onFollowChange: (follow: boolean) => void;
  onRevealAppLog: () => void;
  onRefresh: () => void;
  lastUpdatedAt: string | null;
}

const LEVELS: AppLogLevel[] = ["info", "warn", "error"];

export function LogsSection({
  appEntries,
  jobLogText,
  scope,
  selectedJob,
  onScopeChange,
  follow,
  onFollowChange,
  onRevealAppLog,
  onRefresh,
  lastUpdatedAt,
}: LogsSectionProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeLevels, setActiveLevels] = useState<AppLogLevel[]>([]);
  const allActive = activeLevels.length === 0;
  const scrollerRef = useRef<HTMLDivElement>(null);

  const entries = useMemo<DisplayLogEntry[]>(() => {
    if (scope.kind === "job-file") {
      return parseRawLines(jobLogText);
    }
    const filtered =
      scope.kind === "job-events"
        ? appEntries.filter((entry) => entry.jobId === scope.jobId)
        : appEntries;
    return filtered
      .slice()
      .reverse()
      .map(toDisplayEntry);
  }, [appEntries, jobLogText, scope]);

  const visibleEntries = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return entries.filter((entry) => {
      const level = entry.level ?? "info";
      if (!allActive && !activeLevels.includes(level)) return false;
      if (!term) return true;
      return entry.searchHaystack.includes(term);
    });
  }, [entries, searchTerm, activeLevels, allActive]);

  const errorCount = visibleEntries.filter((entry) => (entry.level ?? "info") === "error").length;
  const isEmptyEvents = scope.kind !== "job-file" && appEntries.length === 0;

  useEffect(() => {
    if (!follow) return;
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [visibleEntries, follow]);

  const handleAllClick = () => {
    setActiveLevels([]);
  };

  const handleLevelsChange = (next: string[]) => {
    if (next.length === 0) {
      setActiveLevels([]);
      return;
    }
    setActiveLevels(next as AppLogLevel[]);
  };

  return (
    <section className="space-y-3" aria-label="Logs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
          Logs
        </h3>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onRefresh} aria-label="Refresh logs">
            Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={onRevealAppLog} aria-label="Reveal app.log">
            <FolderOpen className="h-3.5 w-3.5" />
            Reveal app.log
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-9 min-w-[220px] flex-1 items-center rounded-md border border-[var(--border-default)] bg-white px-3 shadow-sm focus-within:ring-2 focus-within:ring-[var(--ring)] focus-within:ring-offset-2 focus-within:ring-offset-[var(--bg-primary)]">
          <input
            aria-label="Search logs"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search logs"
            className="h-full w-full border-0 bg-transparent p-0 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
          />
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleAllClick}
            data-state={allActive ? "on" : "off"}
            data-testid="severity-all"
            aria-label="Show all severities"
            aria-pressed={allActive}
            className={cn(
              "inline-flex items-center justify-center rounded px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]",
              allActive
                ? "bg-white text-[var(--text-primary)] shadow-sm ring-1 ring-black/5"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            )}
          >
            All
          </button>
          <ToggleGroup
            type="multiple"
            value={activeLevels}
            onValueChange={handleLevelsChange}
            aria-label="Filter logs by severity"
          >
            {LEVELS.map((level) => (
              <ToggleGroupItem
                key={level}
                value={level}
                data-testid={`severity-${level}`}
                aria-label={`Filter ${level}`}
              >
                {capitalize(level)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <Switch
            aria-label="Follow logs"
            checked={follow}
            onCheckedChange={onFollowChange}
          />
          <span>Follow</span>
        </label>
      </div>

      {scope.kind !== "app" ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-sm"
          data-testid="log-scope-strip"
        >
          <div className="text-[var(--text-primary)]">
            {scope.kind === "job-events" ? "Job events" : "Raw run log"}:{" "}
            <span className="font-medium">{scope.title}</span>
          </div>
          <div className="flex items-center gap-2">
            {scope.kind === "job-events" && selectedJob ? (
              <Button
                variant="ghost"
                size="sm"
                data-testid="log-scope-view-raw"
                onClick={() =>
                  onScopeChange({ kind: "job-file", jobId: scope.jobId, title: scope.title })
                }
              >
                View raw run log
              </Button>
            ) : null}
            {scope.kind === "job-file" && selectedJob ? (
              <Button
                variant="ghost"
                size="sm"
                data-testid="log-scope-view-events"
                onClick={() =>
                  onScopeChange({ kind: "job-events", jobId: scope.jobId, title: scope.title })
                }
              >
                View job events
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              data-testid="log-scope-clear"
              onClick={() => onScopeChange({ kind: "app" })}
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--text-primary)] shadow-sm">
        <div
          ref={scrollerRef}
          className="max-h-[36rem] overflow-auto px-4 py-3 font-mono text-xs leading-6 text-[rgba(255,255,255,0.86)]"
          data-testid="log-scroller"
        >
          {visibleEntries.length === 0 ? (
            <div className="text-[rgba(255,255,255,0.45)]">
              {isEmptyEvents
                ? "Structured events appear here as the app does work — record a meeting or run a prompt to see entries."
                : "(no matching log lines)"}
            </div>
          ) : (
            visibleEntries.map((entry) => <LogRow key={entry.id} entry={entry} />)
          )}
        </div>
      </div>

      <div className="text-xs text-[var(--text-secondary)]">
        Showing {visibleEntries.length} {visibleEntries.length === 1 ? "entry" : "entries"} ·{" "}
        {errorCount} {errorCount === 1 ? "error" : "errors"}
        {lastUpdatedAt ? ` · updated ${formatRelativeTime(lastUpdatedAt)}` : null}
      </div>
    </section>
  );
}

function toDisplayEntry(entry: AppLogEntry): DisplayLogEntry {
  const haystack = [
    entry.timestamp,
    entry.level,
    entry.component,
    entry.message,
    entry.detail,
    entry.stack,
    entry.data ? JSON.stringify(entry.data) : null,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return {
    id: entry.id,
    timestamp: entry.timestamp,
    level: entry.level,
    component: entry.component,
    message: entry.message,
    detail: entry.detail,
    stack: entry.stack,
    data: entry.data,
    searchHaystack: haystack,
  };
}

function parseRawLines(content: string): DisplayLogEntry[] {
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
          searchHaystack: line.toLowerCase(),
        } satisfies DisplayLogEntry;
      }
      const [, timestamp, upperLevel, component, remainder] = match;
      const level = normalizeLevel(upperLevel);
      return {
        id: `raw-${timestamp}-${index}`,
        timestamp,
        level,
        component,
        message: remainder,
        searchHaystack: line.toLowerCase(),
      } satisfies DisplayLogEntry;
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

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
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

// re-export for callers needing it
export { isExpandable };
