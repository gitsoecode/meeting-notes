import { useEffect, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { Calendar as CalendarIcon, Pencil } from "lucide-react";
import { Calendar } from "./ui/calendar";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Spinner } from "./ui/spinner";

// ---------------------------------------------------------------------------
// Inline editable description — reads the current description, flips into an
// <Input> on click, saves on Enter/blur, reverts on Escape.
// ---------------------------------------------------------------------------
export function EditableDescription({
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
    <div className="group flex min-w-0 items-center gap-1.5">
      <span className="truncate text-sm text-[var(--text-secondary)] max-w-xs" title={value}>{value}</span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="rounded p-0.5 opacity-0 transition-opacity hover:bg-[var(--bg-secondary)] group-hover:opacity-100"
      >
        <Pencil className="h-3 w-3 text-[var(--text-tertiary)]" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline scheduled-time editor — Popover with a calendar + time input.
// ---------------------------------------------------------------------------
export function InlineScheduledTime({
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
            {format(parseISO(value), "MMM d, yyyy")} at {format(parseISO(value), "h:mm a")}
            <Pencil className="h-3 w-3 text-[var(--text-tertiary)] opacity-0 transition-opacity group-hover:opacity-100" />
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
// Status chip — renders the lifecycle badge ("Draft", "Recording · 3:42",
// "Paused", "Processing…", "Complete · 30.0m", "Error").
// ---------------------------------------------------------------------------
export function StatusLine({
  status,
  elapsed,
  duration,
}: {
  status: string;
  elapsed?: string;
  duration?: number | null;
}) {
  const durationLabel = duration != null ? `${duration.toFixed(1)}m` : null;
  const chipBase = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium";

  switch (status) {
    case "draft":
      return <span className={`${chipBase} bg-[var(--bg-secondary)] text-[var(--text-secondary)]`}>Draft</span>;
    case "recording":
      return (
        <span className={`${chipBase} bg-red-50 text-red-700`}>
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
          </span>
          Recording{elapsed ? ` · ${elapsed}` : ""}
        </span>
      );
    case "paused":
      return (
        <span className={`${chipBase} bg-amber-50 text-amber-700`}>
          <span className="inline-flex h-2 w-2 rounded-full bg-amber-500" />
          Paused
        </span>
      );
    case "processing":
      return (
        <span className={`${chipBase} bg-blue-50 text-blue-700`}>
          <Spinner className="h-3 w-3" /> Processing…
        </span>
      );
    case "complete":
      return (
        <span className={`${chipBase} bg-emerald-50 text-emerald-700`}>
          Complete{durationLabel ? ` · ${durationLabel}` : ""}
        </span>
      );
    case "error":
      return (
        <span className={`${chipBase} bg-red-50 text-red-700`}>
          Error{durationLabel ? ` · ${durationLabel}` : ""}
        </span>
      );
    default:
      return (
        <span className={`${chipBase} bg-[var(--bg-secondary)] text-[var(--text-secondary)]`}>
          {status}{durationLabel ? ` · ${durationLabel}` : ""}
        </span>
      );
  }
}
