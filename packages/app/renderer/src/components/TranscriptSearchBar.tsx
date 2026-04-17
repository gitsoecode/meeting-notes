import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { cn } from "../lib/utils";
import type { EntryMatch } from "../../../shared/transcript-search";

interface TranscriptSearchBarProps {
  /** Called when the debounced query changes. */
  onQueryChange: (query: string) => void;
  /** Flat match list published by TranscriptView. */
  matches: EntryMatch[];
  /** Parent-managed index into `matches` — the "active" match. */
  currentMatchIndex: number | null;
  onCurrentMatchChange: (index: number | null) => void;
  /** Invoked when the user lands on a match (enter / prev / next) so the
   *  parent can scroll the matched entry into view. */
  onNavigateToMatch: (match: EntryMatch) => void;
  /** Cmd+F handler is only installed while this element is mounted and this
   *  prop is true. Lets the parent scope the shortcut to the right tab. */
  shortcutActive: boolean;
  className?: string;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function TranscriptSearchBar({
  onQueryChange,
  matches,
  currentMatchIndex,
  onCurrentMatchChange,
  onNavigateToMatch,
  shortcutActive,
  className,
}: TranscriptSearchBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [rawQuery, setRawQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<number | null>(null);

  // Debounce the query → parent to keep typing responsive on large transcripts.
  useEffect(() => {
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      onQueryChange(rawQuery);
    }, 120);
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    };
  }, [rawQuery, onQueryChange]);

  const open = useCallback(() => {
    setExpanded(true);
    // Focus on next tick so the input is actually mounted.
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  const close = useCallback(() => {
    setExpanded(false);
    setRawQuery("");
    onQueryChange("");
    onCurrentMatchChange(null);
  }, [onQueryChange, onCurrentMatchChange]);

  // Cmd/Ctrl+F — scoped: only when the shortcut is active AND focus isn't
  // already in an input/textarea/contenteditable.
  useEffect(() => {
    if (!shortcutActive) return;
    const handler = (e: KeyboardEvent) => {
      const isFind = (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "f";
      if (!isFind) return;
      if (isEditableTarget(e.target) && !inputRef.current?.contains(e.target as Node)) {
        return;
      }
      e.preventDefault();
      open();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shortcutActive, open]);

  const navigate = useCallback(
    (direction: 1 | -1) => {
      if (matches.length === 0) {
        onCurrentMatchChange(null);
        return;
      }
      const start = currentMatchIndex ?? (direction === 1 ? -1 : matches.length);
      const next = (start + direction + matches.length) % matches.length;
      onCurrentMatchChange(next);
      onNavigateToMatch(matches[next]);
    },
    [matches, currentMatchIndex, onCurrentMatchChange, onNavigateToMatch],
  );

  // Reset currentMatchIndex when the match list changes under us so the
  // "active" indicator doesn't point at a stale match after typing.
  const prevMatchCountRef = useRef(matches.length);
  useEffect(() => {
    if (matches.length !== prevMatchCountRef.current) {
      prevMatchCountRef.current = matches.length;
      if (matches.length === 0) {
        onCurrentMatchChange(null);
      } else if (currentMatchIndex == null || currentMatchIndex >= matches.length) {
        onCurrentMatchChange(0);
        onNavigateToMatch(matches[0]);
      }
    }
  }, [matches, currentMatchIndex, onCurrentMatchChange, onNavigateToMatch]);

  const summary = useMemo(() => {
    if (matches.length === 0) return rawQuery.trim() ? "No matches" : "";
    const i = currentMatchIndex ?? 0;
    return `${i + 1} / ${matches.length}`;
  }, [matches.length, currentMatchIndex, rawQuery]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      navigate(e.shiftKey ? -1 : 1);
      return;
    }
  };

  if (!expanded) {
    return (
      <div className={cn("flex justify-end", className)}>
        <Button
          variant="ghost"
          size="sm"
          onClick={open}
          aria-label="Search transcript"
          title="Search transcript (⌘F)"
          className="text-[var(--text-secondary)]"
        >
          <Search className="h-4 w-4" />
          <span className="ml-1.5 text-xs">Search</span>
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "sticky top-0 z-10 flex items-center gap-2 rounded-lg border border-[var(--border-default)] bg-white px-2 py-1.5 shadow-sm",
        className,
      )}
      role="search"
    >
      <Search className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
      <Input
        ref={inputRef}
        value={rawQuery}
        placeholder="Search transcript…"
        onChange={(e) => setRawQuery(e.target.value)}
        onKeyDown={onKeyDown}
        className="h-7 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
      />
      <span
        className={cn(
          "shrink-0 text-xs tabular-nums",
          matches.length === 0 && rawQuery.trim()
            ? "text-[var(--error)]"
            : "text-[var(--text-secondary)]",
        )}
        aria-live="polite"
      >
        {summary}
      </span>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(-1)}
          disabled={matches.length === 0}
          aria-label="Previous match"
          title="Previous (Shift+Enter)"
          className="h-7 w-7"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(1)}
          disabled={matches.length === 0}
          aria-label="Next match"
          title="Next (Enter)"
          className="h-7 w-7"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={close}
          aria-label="Close search"
          title="Close (Esc)"
          className="h-7 w-7"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
