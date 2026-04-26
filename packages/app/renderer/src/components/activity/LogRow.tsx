import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { AppLogLevel } from "../../../../shared/ipc";
import { cn } from "../../lib/utils";

export interface DisplayLogEntry {
  id: string;
  timestamp?: string;
  level?: AppLogLevel;
  component?: string;
  message: string;
  detail?: string;
  stack?: string;
  data?: Record<string, unknown>;
  searchHaystack: string;
}

const EXTRACTED_KEYS = new Set([
  "jobId",
  "job_id",
  "runFolder",
  "run_folder",
  "processType",
  "process_type",
  "pid",
  "stack",
  "detail",
]);

export function isExpandable(entry: DisplayLogEntry): boolean {
  if (entry.detail || entry.stack) return true;
  if (!entry.data) return false;
  return Object.keys(entry.data).some((key) => !EXTRACTED_KEYS.has(key));
}

export function LogRow({ entry }: { entry: DisplayLogEntry }) {
  const expandable = isExpandable(entry);
  const [open, setOpen] = useState(false);

  const extra = entry.data
    ? Object.fromEntries(Object.entries(entry.data).filter(([key]) => !EXTRACTED_KEYS.has(key)))
    : null;
  const hasExtra = extra && Object.keys(extra).length > 0;

  return (
    <div
      className="border-b border-white/5 py-1 last:border-b-0"
      data-testid="log-row"
      data-expandable={expandable ? "true" : "false"}
    >
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        className={cn(
          "flex w-full items-start gap-2 text-left",
          expandable
            ? "cursor-pointer hover:bg-white/5 rounded px-1 -mx-1"
            : "cursor-default"
        )}
      >
        {expandable ? (
          open ? (
            <ChevronDown className="mt-0.5 h-3 w-3 shrink-0 text-[rgba(255,255,255,0.45)]" />
          ) : (
            <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-[rgba(255,255,255,0.45)]" />
          )
        ) : (
          <span className="mt-0.5 inline-block h-3 w-3 shrink-0" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1 whitespace-pre-wrap break-words">
          {renderPrefix(entry)}
          <span className={lineClassForLevel(entry.level)}>{entry.message}</span>
        </div>
      </button>
      {open && expandable ? (
        <div className="mt-1 ml-5 space-y-1 text-[rgba(255,255,255,0.7)]" data-testid="log-row-expanded">
          {entry.detail ? (
            <div>
              <span className="text-[rgba(255,255,255,0.45)]">detail: </span>
              {entry.detail}
            </div>
          ) : null}
          {hasExtra ? (
            <div>
              <span className="text-[rgba(255,255,255,0.45)]">data: </span>
              <span className="text-[rgba(180,210,255,0.85)]">{JSON.stringify(extra)}</span>
            </div>
          ) : null}
          {entry.stack ? (
            <pre className="whitespace-pre-wrap text-[rgba(255,255,255,0.55)]">{entry.stack}</pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function renderPrefix(entry: DisplayLogEntry) {
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

function formatTime(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  return new Date(time).toLocaleTimeString();
}
