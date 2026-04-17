import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { cn, stripFrontmatter } from "../lib/utils";
import { parseTimestamp, findActiveEntryIndex } from "../../../shared/timestamps";
import {
  buildMatches,
  buildEntryMatchSet,
  entryKey,
  splitWithHighlights,
  type EntryMatch,
} from "../../../shared/transcript-search";
import { usePlayback } from "./MeetingAudioPlayer";

interface TranscriptEntry {
  speaker: string | null;
  timestamp: string | null;
  text: string;
}

interface SpeakerGroup {
  speaker: string | null;
  firstTimestamp: string | null;
  entries: TranscriptEntry[];
}

/**
 * Parse the transcript markdown into a flat list of entries with speaker info,
 * then collapse consecutive same-speaker entries into a single group.
 *
 * The engine emits markdown of the form:
 *   ### Me
 *
 *   `00:00` Hello.
 *
 *   `00:05` How are you.
 *
 *   ### Others
 *
 *   `00:10` Good thanks.
 *
 * Lines that appear before any `### Heading` are kept under `speaker: null`.
 * Bare lines (no `` `MM:SS` `` prefix) become entries with `timestamp: null`.
 */
export function parseTranscriptGroups(source: string): SpeakerGroup[] {
  const lines = stripFrontmatter(source)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const entries: TranscriptEntry[] = [];
  let currentSpeaker: string | null = null;

  for (const line of lines) {
    if (line.startsWith("### ")) {
      currentSpeaker = line.slice(4).trim() || null;
      continue;
    }

    const match = line.match(/^`(\d{1,2}:\d{2}(?::\d{2})?)`\s+(.*)$/);
    entries.push({
      speaker: currentSpeaker,
      timestamp: match?.[1] ?? null,
      text: match?.[2] ?? line,
    });
  }

  const groups: SpeakerGroup[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.speaker === entry.speaker) {
      last.entries.push(entry);
      continue;
    }
    groups.push({
      speaker: entry.speaker,
      firstTimestamp: entry.timestamp,
      entries: [entry],
    });
  }

  return groups;
}

export function speakerInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  const word = words[0];
  if (word.length === 2) return word.toUpperCase();
  return word[0].toUpperCase();
}

const SPEAKER_PALETTE: Array<{ fallback: string }> = [
  { fallback: "bg-amber-100 text-amber-700" },
  { fallback: "bg-violet-100 text-violet-700" },
  { fallback: "bg-rose-100 text-rose-700" },
  { fallback: "bg-sky-100 text-sky-700" },
  { fallback: "bg-teal-100 text-teal-700" },
  { fallback: "bg-fuchsia-100 text-fuchsia-700" },
];

export function speakerStyles(name: string): { fallback: string } {
  if (name === "Me") return { fallback: "bg-blue-100 text-blue-700" };
  if (name === "Others") return { fallback: "bg-emerald-100 text-emerald-700" };

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return SPEAKER_PALETTE[hash % SPEAKER_PALETTE.length];
}

// ---------------------------------------------------------------------------

export interface TranscriptViewHandle {
  /** Scroll the entry containing this match into view, centered. */
  scrollToMatch: (match: EntryMatch) => void;
}

export interface TranscriptViewProps {
  source: string;
  /** When true, clicking a timestamp plays the combined audio at that time. */
  combinedAudioAvailable: boolean;
  /** Optional search query; matches are highlighted and non-matching entries
   *  are dimmed when a query is present. */
  searchQuery?: string;
  /** Reports total match count + flat match list so a parent search bar can
   *  drive prev/next navigation. Fires whenever the set of matches changes. */
  onMatchesChange?: (matches: EntryMatch[]) => void;
  /** Index into the flat match list — the currently "active" match that the
   *  parent is navigating to. Highlighted distinctly. */
  currentMatchIndex?: number | null;
}

export const TranscriptView = forwardRef<TranscriptViewHandle, TranscriptViewProps>(
  function TranscriptView(
    { source, combinedAudioAvailable, searchQuery = "", onMatchesChange, currentMatchIndex },
    ref,
  ) {
    const playback = usePlayback();

    const groups = useMemo(() => parseTranscriptGroups(source), [source]);

    // Flat timed-entry list used both for search and active-line scanning.
    const flatEntries = useMemo(
      () =>
        groups.flatMap((group, groupIndex) =>
          group.entries.map((entry, entryIndex) => ({
            groupIndex,
            entryIndex,
            text: entry.text,
            timeSec: parseTimestamp(entry.timestamp),
          })),
        ),
      [groups],
    );

    const matches = useMemo(() => buildMatches(flatEntries, searchQuery), [
      flatEntries,
      searchQuery,
    ]);
    const matchSet = useMemo(() => buildEntryMatchSet(matches), [matches]);

    // Publish match changes to the parent search bar.
    const lastMatchesRef = useRef<EntryMatch[] | null>(null);
    if (lastMatchesRef.current !== matches) {
      lastMatchesRef.current = matches;
      onMatchesChange?.(matches);
    }

    const activeEntryIndex = useMemo(
      () => findActiveEntryIndex(flatEntries, playback.currentTimeSec),
      [flatEntries, playback.currentTimeSec],
    );
    const activeEntryKey =
      activeEntryIndex != null
        ? entryKey(
            flatEntries[activeEntryIndex].groupIndex,
            flatEntries[activeEntryIndex].entryIndex,
          )
        : null;

    const entryRefs = useRef<Map<string, HTMLElement>>(new Map());
    const rootRef = useRef<HTMLDivElement | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        scrollToMatch: (match: EntryMatch) => {
          const el = entryRefs.current.get(entryKey(match.groupIndex, match.entryIndex));
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
        },
      }),
      [],
    );

    // --- Auto-scroll follow mode ---------------------------------------------
    //
    // Default: the transcript auto-scrolls the active (currently-playing)
    // entry into view. If the user manually scrolls/wheels/touches or uses
    // arrow keys to read ahead, we pause following for a few seconds so we
    // don't yank the viewport back. An explicit seek (timestamp click →
    // lastSeekAt tick) always re-engages follow mode.
    //
    // We detect *user-initiated* scroll via the input events themselves
    // (wheel/touchstart/keydown), not the scroll event, because programmatic
    // `scrollIntoView` also fires scroll — we'd pause ourselves otherwise.
    const [followMode, setFollowMode] = useState(true);
    const pauseTimerRef = useRef<number | null>(null);

    const pauseFollowing = (durationMs = 4000) => {
      setFollowMode(false);
      if (pauseTimerRef.current != null) window.clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = window.setTimeout(() => {
        pauseTimerRef.current = null;
      }, durationMs);
    };

    // Explicit seek from the pocket player (timestamp click) re-engages
    // follow mode. We key off `lastSeekAt` so only actual seek events trigger
    // this, not steady time updates.
    useEffect(() => {
      if (playback.lastSeekAt === 0) return;
      if (pauseTimerRef.current != null) {
        window.clearTimeout(pauseTimerRef.current);
        pauseTimerRef.current = null;
      }
      setFollowMode(true);
    }, [playback.lastSeekAt]);

    // User-initiated scroll gestures inside the transcript → pause follow.
    useEffect(() => {
      const root = rootRef.current;
      if (!root) return;
      const onUserScroll = () => pauseFollowing();
      const onKeyDown = (e: KeyboardEvent) => {
        const scrollKeys = [
          "ArrowUp",
          "ArrowDown",
          "PageUp",
          "PageDown",
          "Home",
          "End",
          " ",
        ];
        if (scrollKeys.includes(e.key)) pauseFollowing();
      };
      root.addEventListener("wheel", onUserScroll, { passive: true });
      root.addEventListener("touchstart", onUserScroll, { passive: true });
      root.addEventListener("keydown", onKeyDown);
      return () => {
        root.removeEventListener("wheel", onUserScroll);
        root.removeEventListener("touchstart", onUserScroll);
        root.removeEventListener("keydown", onKeyDown);
        if (pauseTimerRef.current != null) {
          window.clearTimeout(pauseTimerRef.current);
          pauseTimerRef.current = null;
        }
      };
    }, []);

    // Scroll the active line into view whenever it changes AND follow mode
    // is engaged. Only does work if playback is open (isOpen) — we don't
    // want to yank the viewport when a user is just reading the transcript.
    useEffect(() => {
      if (!followMode) return;
      if (!playback.isOpen) return;
      if (activeEntryKey == null) return;
      const el = entryRefs.current.get(activeEntryKey);
      if (!el) return;
      // Only scroll when the active line is actually off-screen (or near
      // the viewport edge). Avoids "snap to center" jitter on every entry
      // change while the user is already looking at the right spot.
      const rect = el.getBoundingClientRect();
      const margin = 80;
      const outside =
        rect.top < margin || rect.bottom > window.innerHeight - margin;
      if (outside) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, [activeEntryKey, followMode, playback.isOpen]);

    const currentMatch =
      currentMatchIndex != null && currentMatchIndex >= 0 && currentMatchIndex < matches.length
        ? matches[currentMatchIndex]
        : null;

    if (groups.length === 0) {
      return (
        <div className="text-sm text-[var(--text-secondary)]">Transcript unavailable.</div>
      );
    }

    const dimNonMatches = searchQuery.trim().length > 0 && matches.length > 0;

    // Show a small "Jump to current" affordance when auto-scroll is paused
    // and playback is active — lets users re-engage follow mode in one click.
    const showFollowPrompt = !followMode && playback.isOpen && activeEntryKey != null;

    const jumpToCurrent = () => {
      if (pauseTimerRef.current != null) {
        window.clearTimeout(pauseTimerRef.current);
        pauseTimerRef.current = null;
      }
      setFollowMode(true);
      if (activeEntryKey) {
        const el = entryRefs.current.get(activeEntryKey);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    };

    return (
      <div ref={rootRef} data-transcript-root className="relative flex flex-col gap-6">
        {showFollowPrompt ? (
          <button
            type="button"
            onClick={jumpToCurrent}
            className="sticky top-2 z-20 mx-auto w-fit rounded-full border border-[var(--border-default)] bg-white px-3 py-1 text-xs text-[var(--text-secondary)] shadow-sm hover:text-[var(--text-primary)]"
          >
            Jump to current
          </button>
        ) : null}
        {groups.map((group, groupIndex) => (
          <div key={groupIndex} className="flex gap-4">
            {group.speaker ? (
              <div className="flex-shrink-0 mt-1">
                <Avatar className="h-9 w-9">
                  <AvatarFallback
                    className={cn(
                      "text-xs font-medium",
                      speakerStyles(group.speaker).fallback,
                    )}
                  >
                    {speakerInitials(group.speaker)}
                  </AvatarFallback>
                </Avatar>
              </div>
            ) : null}

            <div className="flex flex-1 flex-col gap-1 min-w-0">
              {group.speaker ? (
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">
                    {group.speaker}
                  </span>
                </div>
              ) : null}

              <div className="flex flex-col gap-1.5 text-base leading-relaxed text-[var(--text-primary)]">
                {group.entries.map((entry, entryIndex) => {
                  const key = entryKey(groupIndex, entryIndex);
                  const isActive = activeEntryKey === key;
                  const hasMatch = matchSet.has(key);
                  const dim = dimNonMatches && !hasMatch;
                  const isCurrentMatchEntry =
                    currentMatch != null &&
                    currentMatch.groupIndex === groupIndex &&
                    currentMatch.entryIndex === entryIndex;
                  return (
                    <TranscriptLine
                      key={key}
                      entry={entry}
                      entryKeyValue={key}
                      isActive={isActive}
                      dim={dim}
                      isCurrentMatch={isCurrentMatchEntry}
                      searchQuery={searchQuery}
                      combinedAudioAvailable={combinedAudioAvailable}
                      onSeek={(sec) => void playback.seekAndPlay(sec)}
                      registerRef={(el) => {
                        if (el) entryRefs.current.set(key, el);
                        else entryRefs.current.delete(key);
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  },
);

interface TranscriptLineProps {
  entry: TranscriptEntry;
  entryKeyValue: string;
  isActive: boolean;
  dim: boolean;
  isCurrentMatch: boolean;
  searchQuery: string;
  combinedAudioAvailable: boolean;
  onSeek: (sec: number) => void;
  registerRef: (el: HTMLElement | null) => void;
}

function TranscriptLine({
  entry,
  entryKeyValue,
  isActive,
  dim,
  isCurrentMatch,
  searchQuery,
  combinedAudioAvailable,
  onSeek,
  registerRef,
}: TranscriptLineProps) {
  const timeSec = parseTimestamp(entry.timestamp);
  const clickable =
    combinedAudioAvailable && entry.timestamp != null && Number.isFinite(timeSec);

  const segments = splitWithHighlights(entry.text, searchQuery);

  const lineClasses = cn(
    "group flex w-full items-start gap-3 rounded-md border-l-2 border-transparent py-1 pl-2 pr-2 text-left transition-colors",
    clickable && "cursor-pointer hover:bg-[var(--bg-hover)]",
    isActive && "border-[var(--accent)] bg-[var(--accent-muted)]",
    dim && "opacity-40",
  );

  const content = (
    <>
      {entry.timestamp ? (
        <span
          className={cn(
            "mt-0.5 shrink-0 font-mono text-xs",
            clickable
              ? "text-[var(--text-tertiary)] group-hover:text-[var(--accent)]"
              : "text-[var(--text-tertiary)]",
          )}
          title={clickable ? "Play from here" : entry.timestamp}
        >
          {entry.timestamp}
        </span>
      ) : (
        <span className="mt-0.5 shrink-0 w-8" aria-hidden="true" />
      )}
      <p className="flex-1 whitespace-pre-wrap break-words">
        {segments.map((seg, i) =>
          seg.highlighted ? (
            <mark
              key={i}
              className={cn(
                "rounded px-0.5",
                isCurrentMatch
                  ? "bg-[var(--accent)] text-[var(--text-inverse)]"
                  : "bg-yellow-200 text-[var(--text-primary)]",
              )}
            >
              {seg.text}
            </mark>
          ) : (
            <span key={i}>{seg.text}</span>
          ),
        )}
      </p>
    </>
  );

  // Whole-line tap target: render the row as a <button> when clickable so
  // anywhere on the line seeks and plays. Non-clickable lines (no
  // timestamp, or no combined audio) render as plain <div>.
  if (clickable) {
    return (
      <button
        type="button"
        ref={registerRef as (el: HTMLButtonElement | null) => void}
        data-entry-key={entryKeyValue}
        onClick={() => onSeek(timeSec)}
        aria-label={`Play from ${entry.timestamp}`}
        className={cn(
          lineClasses,
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]",
        )}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      ref={registerRef}
      data-entry-key={entryKeyValue}
      className={lineClasses}
    >
      {content}
    </div>
  );
}
