import { Play } from "lucide-react";
import { cn } from "../lib/utils";

interface TimestampPillProps {
  label: string;
  startMs: number;
  onClick?: (startMs: number) => void;
  className?: string;
  /** When rendered inside a transcript line, no meeting title label is needed. */
  compact?: boolean;
}

/**
 * Clickable monospace pill used for seekable citations in chat and for
 * per-line transcript timestamps. Plays the combined audio at `startMs`.
 */
export function TimestampPill({
  label,
  startMs,
  onClick,
  className,
  compact = false,
}: TimestampPillProps) {
  return (
    <button
      type="button"
      onClick={() => onClick?.(startMs)}
      data-testid="timestamp-pill"
      data-start-ms={startMs}
      aria-label={`Play from ${label}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-1.5 py-0.5 font-mono text-xs text-[var(--text-primary)] hover:bg-[rgba(45,107,63,0.08)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ring)]",
        compact && "border-transparent bg-transparent",
        className,
      )}
    >
      <Play className="h-3 w-3 opacity-70" aria-hidden />
      <span>{label}</span>
    </button>
  );
}

export function msToMmSs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  if (mm >= 60) {
    const hh = Math.floor(mm / 60);
    const rem = mm % 60;
    return `${hh}:${String(rem).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
