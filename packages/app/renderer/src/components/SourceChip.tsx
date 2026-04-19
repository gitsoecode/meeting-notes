import { FileText, NotebookPen, Sparkles, StickyNote } from "lucide-react";
import { cn } from "../lib/utils";
import type { ChatCitationSource } from "../../../shared/ipc";

interface SourceChipProps {
  title: string;
  source: ChatCitationSource;
  onClick?: () => void;
  className?: string;
}

const SOURCE_META: Record<ChatCitationSource, { icon: typeof FileText; label: string }> = {
  transcript: { icon: FileText, label: "Transcript" },
  summary: { icon: Sparkles, label: "Summary" },
  prep: { icon: NotebookPen, label: "Prep notes" },
  notes: { icon: StickyNote, label: "Notes" },
};

/**
 * Citation chip for non-seekable sources — summary, prep, notes, or an
 * imported meeting without transcript timestamps. Deliberately looks
 * different from TimestampPill so users don't expect audio playback.
 */
export function SourceChip({ title, source, onClick, className }: SourceChipProps) {
  const meta = SOURCE_META[source];
  const Icon = meta.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="source-chip"
      data-source={source}
      aria-label={`Open ${title} (${meta.label})`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-dashed border-[var(--border-subtle)] bg-transparent px-1.5 py-0.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ring)]",
        className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      <span className="truncate">{title}</span>
      <span className="opacity-60">· {meta.label}</span>
    </button>
  );
}
