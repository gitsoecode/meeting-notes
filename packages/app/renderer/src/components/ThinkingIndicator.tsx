import { cn } from "../lib/utils";

interface ThinkingIndicatorProps {
  /** Optional status label shown next to the dots (e.g. "Searching meetings…"). */
  label?: string | null;
  className?: string;
}

/**
 * Three bouncing dots shown while the assistant is working but hasn't
 * produced any output tokens yet. Uses pure Tailwind keyframes so no
 * extra dependency is required. Accompanied by an optional label.
 */
export function ThinkingIndicator({ label, className }: ThinkingIndicatorProps) {
  return (
    <div
      className={cn("flex items-center gap-2 text-xs text-[var(--text-tertiary)]", className)}
      data-testid="chat-thinking-indicator"
      aria-live="polite"
    >
      <span className="flex items-end gap-1" aria-hidden>
        <span className="inline-block h-1.5 w-1.5 animate-[chat-dot-bounce_1s_ease-in-out_infinite] rounded-full bg-[var(--text-tertiary)]" />
        <span
          className="inline-block h-1.5 w-1.5 animate-[chat-dot-bounce_1s_ease-in-out_infinite] rounded-full bg-[var(--text-tertiary)]"
          style={{ animationDelay: "0.15s" }}
        />
        <span
          className="inline-block h-1.5 w-1.5 animate-[chat-dot-bounce_1s_ease-in-out_infinite] rounded-full bg-[var(--text-tertiary)]"
          style={{ animationDelay: "0.3s" }}
        />
      </span>
      {label ? <span className="truncate">{label}</span> : null}
    </div>
  );
}
