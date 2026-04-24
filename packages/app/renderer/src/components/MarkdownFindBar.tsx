import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { cn } from "../lib/utils";

interface MarkdownFindBarProps {
  /** Container whose rendered text should be searchable. Usually the
   *  `MarkdownView` root. */
  contentRef: React.RefObject<HTMLElement | null>;
  /** Bumps whenever the rendered content source changes so the bar re-runs
   *  highlighting against the fresh DOM (React re-sets innerHTML and wipes
   *  prior marks). Pass the markdown source string or a derived key. */
  contentKey?: string | number;
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

const MARK_CLASS = "markdown-find-match";
const MARK_ACTIVE_CLASS = "markdown-find-match--active";

function unwrapMarks(container: HTMLElement): void {
  const marks = container.querySelectorAll(`mark.${MARK_CLASS}`);
  marks.forEach((m) => {
    const parent = m.parentNode;
    if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
  });
  container.normalize();
}

function wrapMatches(container: HTMLElement, needle: string): HTMLElement[] {
  const lower = needle.toLowerCase();
  const marks: HTMLElement[] = [];
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === "SCRIPT" || tag === "STYLE") return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let cur: Node | null;
  while ((cur = walker.nextNode())) nodes.push(cur as Text);
  for (const node of nodes) {
    const text = node.nodeValue ?? "";
    const lowerText = text.toLowerCase();
    if (!lowerText.includes(lower)) continue;
    const frag = document.createDocumentFragment();
    let from = 0;
    while (from <= lowerText.length) {
      const at = lowerText.indexOf(lower, from);
      if (at === -1) {
        if (from < text.length) frag.appendChild(document.createTextNode(text.slice(from)));
        break;
      }
      if (at > from) frag.appendChild(document.createTextNode(text.slice(from, at)));
      const mark = document.createElement("mark");
      mark.className = MARK_CLASS;
      mark.textContent = text.slice(at, at + needle.length);
      frag.appendChild(mark);
      marks.push(mark);
      from = at + needle.length;
    }
    node.parentNode?.replaceChild(frag, node);
  }
  return marks;
}

export function MarkdownFindBar({
  contentRef,
  contentKey,
  shortcutActive,
  className,
}: MarkdownFindBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [rawQuery, setRawQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const marksRef = useRef<HTMLElement[]>([]);
  const debounceTimer = useRef<number | null>(null);

  useEffect(() => {
    if (debounceTimer.current != null) window.clearTimeout(debounceTimer.current);
    debounceTimer.current = window.setTimeout(() => {
      setDebouncedQuery(rawQuery);
    }, 120);
    return () => {
      if (debounceTimer.current != null) window.clearTimeout(debounceTimer.current);
    };
  }, [rawQuery]);

  useEffect(() => {
    const container = contentRef.current;
    if (!container) {
      marksRef.current = [];
      setMatchCount(0);
      setCurrentIndex(null);
      return;
    }
    unwrapMarks(container);
    const needle = debouncedQuery.trim();
    const marks = needle ? wrapMatches(container, needle) : [];
    marksRef.current = marks;
    setMatchCount(marks.length);
    setCurrentIndex(marks.length > 0 ? 0 : null);
    return () => {
      const c = contentRef.current;
      if (c) unwrapMarks(c);
      marksRef.current = [];
    };
  }, [debouncedQuery, contentKey, contentRef]);

  useEffect(() => {
    const marks = marksRef.current;
    marks.forEach((m, i) => {
      if (i === currentIndex) m.classList.add(MARK_ACTIVE_CLASS);
      else m.classList.remove(MARK_ACTIVE_CLASS);
    });
    if (currentIndex != null && marks[currentIndex]) {
      marks[currentIndex].scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [currentIndex, matchCount]);

  const open = useCallback(() => {
    setExpanded(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  const close = useCallback(() => {
    setExpanded(false);
    setRawQuery("");
    setDebouncedQuery("");
  }, []);

  useEffect(() => {
    if (!shortcutActive) return;
    const handler = (e: KeyboardEvent) => {
      const isFind = (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "f";
      if (!isFind) return;
      if (isEditableTarget(e.target) && !inputRef.current?.contains(e.target as Node)) return;
      e.preventDefault();
      open();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shortcutActive, open]);

  const navigate = useCallback(
    (dir: 1 | -1) => {
      if (matchCount === 0) return;
      const start = currentIndex ?? (dir === 1 ? -1 : matchCount);
      const next = ((start + dir) % matchCount + matchCount) % matchCount;
      setCurrentIndex(next);
    },
    [matchCount, currentIndex],
  );

  const summary = useMemo(() => {
    if (matchCount === 0) return rawQuery.trim() ? "No matches" : "";
    const i = currentIndex ?? 0;
    return `${i + 1} / ${matchCount}`;
  }, [matchCount, currentIndex, rawQuery]);

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
          aria-label="Find in text"
          title="Find (⌘F)"
          className="text-[var(--text-secondary)]"
        >
          <Search className="h-4 w-4" />
          <span className="ml-1.5 text-xs">Find</span>
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
        placeholder="Find…"
        onChange={(e) => setRawQuery(e.target.value)}
        onKeyDown={onKeyDown}
        className="h-7 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
      />
      <span
        className={cn(
          "shrink-0 text-xs tabular-nums",
          matchCount === 0 && rawQuery.trim()
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
          disabled={matchCount === 0}
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
          disabled={matchCount === 0}
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
          aria-label="Close find"
          title="Close (Esc)"
          className="h-7 w-7"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
