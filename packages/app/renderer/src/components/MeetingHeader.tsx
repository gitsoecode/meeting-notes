import { useEffect, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  ChevronDown,
  Pencil,
  X,
} from "lucide-react";
import { Button } from "./ui/button";
import { Calendar } from "./ui/calendar";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Spinner } from "./ui/spinner";

// ---------------------------------------------------------------------------
// Inline editable title (renders as span so parent can wrap in any heading)
// ---------------------------------------------------------------------------
function EditableTitle({
  value,
  onSave,
}: {
  value: string;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { onSave(draft); setEditing(false); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { onSave(draft); setEditing(false); }
            if (e.key === "Escape") { setDraft(value); setEditing(false); }
          }}
          className="text-2xl font-semibold h-auto py-1"
        />
        <Button variant="ghost" size="sm" onClick={() => { setDraft(value); setEditing(false); }}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 group">
      <span className="text-2xl font-semibold text-[var(--text-primary)]">{value}</span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-[var(--bg-secondary)]"
      >
        <Pencil className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline editable description
// ---------------------------------------------------------------------------
function EditableDescription({
  value,
  onSave,
}: {
  value: string;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { onSave(draft); setEditing(false); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { onSave(draft); setEditing(false); }
          if (e.key === "Escape") { setDraft(value); setEditing(false); }
        }}
        placeholder="Add a description…"
        className="h-auto py-0.5 text-sm text-[var(--text-secondary)] border-none bg-transparent px-0 shadow-none focus-visible:ring-0"
      />
    );
  }

  if (!value.trim()) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="flex items-center gap-1 text-sm text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
      >
        <Pencil className="h-3 w-3" /> Add description
      </button>
    );
  }

  return (
    <div className="group flex items-center gap-1.5">
      <span className="text-sm text-[var(--text-secondary)]">{value}</span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-[var(--bg-secondary)]"
      >
        <Pencil className="h-3 w-3 text-[var(--text-tertiary)]" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline scheduled time (popover with DateTimePicker calendar + time input)
// ---------------------------------------------------------------------------
function InlineScheduledTime({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (iso: string | null) => void;
}) {
  const [open, setOpen] = useState(false);

  const selectedDate = value ? (() => { try { return parseISO(value); } catch { return undefined; } })() : undefined;
  const timeValue = value
    ? (() => {
        try {
          const d = parseISO(value);
          return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        } catch { return ""; }
      })()
    : "";

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) { onChange(null); setOpen(false); return; }
    const [hh, mm] = timeValue ? timeValue.split(":").map(Number) : [9, 0];
    date.setHours(hh, mm, 0, 0);
    onChange(date.toISOString());
    setOpen(false);
  };

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = e.target.value;
    if (!time) return;
    const [hh, mm] = time.split(":").map(Number);
    const base = selectedDate ? new Date(selectedDate) : new Date();
    base.setHours(hh, mm, 0, 0);
    onChange(base.toISOString());
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {value ? (
          <button
            type="button"
            className="group inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          >
            <CalendarIcon className="h-3 w-3" />
            {format(parseISO(value), "MMM d, yyyy")} at{" "}
            {format(parseISO(value), "h:mm a")}
            <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-[var(--text-tertiary)]" />
          </button>
        ) : (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
          >
            <CalendarIcon className="h-3 w-3" /> Schedule
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <div className="space-y-3">
          <Calendar
            mode="single"
            selected={selectedDate}
            defaultMonth={selectedDate}
            onSelect={handleDateSelect}
          />
          <div className="flex items-center gap-2 border-t border-[var(--border-default)] pt-3">
            <label className="text-xs font-medium text-[var(--text-secondary)]">Time</label>
            <Input
              type="time"
              value={timeValue}
              onChange={handleTimeChange}
              className="h-8 w-32 appearance-none text-sm [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Status line rendering
// ---------------------------------------------------------------------------
function StatusLine({
  status,
  elapsed,
  duration,
}: {
  status: string;
  elapsed?: string;
  duration?: number | null;
}) {
  const durationLabel = duration != null ? `${duration.toFixed(1)}m` : null;

  switch (status) {
    case "draft":
      return <span className="text-sm font-medium text-[var(--text-secondary)]">Draft</span>;

    case "recording":
      return (
        <span className="flex items-center gap-2 text-sm font-medium text-[var(--accent)]">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
          </span>
          Recording{elapsed ? ` · ${elapsed}` : ""}
        </span>
      );

    case "paused":
      return (
        <span className="flex items-center gap-2 text-sm font-medium text-amber-600">
          <span className="inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
          Paused
        </span>
      );

    case "processing":
      return (
        <span className="flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)]">
          <Spinner className="h-3.5 w-3.5" />
          Processing…
        </span>
      );

    case "complete":
      return (
        <span className="text-sm text-[var(--text-secondary)]">
          Complete{durationLabel ? ` · ${durationLabel}` : ""}
        </span>
      );

    case "error":
      return (
        <span className="text-sm text-[var(--error)]">
          Error{durationLabel ? ` · ${durationLabel}` : ""}
        </span>
      );

    default:
      return (
        <span className="text-sm text-[var(--text-secondary)]">
          {status}{durationLabel ? ` · ${durationLabel}` : ""}
        </span>
      );
  }
}

// ---------------------------------------------------------------------------
// MeetingHeader — unified header for all meeting states
// ---------------------------------------------------------------------------
export interface MeetingHeaderProps {
  status: string;
  title: string;
  description?: string | null;
  scheduledTime?: string | null;
  duration?: number | null;
  /** Elapsed time label for recording state, e.g. "3:42" */
  elapsed?: string;
  /** ISO timestamp shown for completed meetings */
  timestamp?: string;
  /** Callback to save title — when provided, title is editable */
  onTitleSave?: (v: string) => void;
  /** Callback to save description — when provided, description is editable */
  onDescriptionSave?: (v: string) => void;
  /** Callback for scheduled time changes */
  onScheduledTimeChange?: (iso: string | null) => void;
  /** "← Back to meetings" handler */
  onBack?: () => void;
  /** Right-side action buttons */
  actions?: React.ReactNode;
}

export function MeetingHeader({
  status,
  title,
  description,
  scheduledTime,
  duration,
  elapsed,
  timestamp,
  onTitleSave,
  onDescriptionSave,
  onScheduledTimeChange,
  onBack,
  actions,
}: MeetingHeaderProps) {
  return (
    <div className="space-y-1.5">
      {/* Breadcrumb */}
      {onBack && (
        <Button variant="ghost" className="w-fit px-0 text-sm -mb-1" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back to meetings
        </Button>
      )}

      {/* Status line */}
      <StatusLine status={status} elapsed={elapsed} duration={duration} />

      {/* Title + actions row */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {onTitleSave ? (
            <EditableTitle value={title} onSave={onTitleSave} />
          ) : (
            <h2 className="text-2xl font-semibold text-[var(--text-primary)]">{title}</h2>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2 pt-1">
            {actions}
          </div>
        )}
      </div>

      {/* Description + scheduled time / timestamp line */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {onDescriptionSave ? (
          <EditableDescription value={description ?? ""} onSave={onDescriptionSave} />
        ) : description ? (
          <span className="text-sm text-[var(--text-secondary)]">{description}</span>
        ) : null}

        {onScheduledTimeChange && (
          <>
            {(description || onDescriptionSave) && <span className="text-[var(--text-tertiary)]">·</span>}
            <InlineScheduledTime value={scheduledTime ?? null} onChange={onScheduledTimeChange} />
          </>
        )}

        {timestamp && !onScheduledTimeChange && (
          <>
            {(description || onDescriptionSave) && <span className="text-[var(--text-tertiary)]">·</span>}
            <span className="text-sm text-[var(--text-secondary)]">
              {new Date(timestamp).toLocaleString()}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
