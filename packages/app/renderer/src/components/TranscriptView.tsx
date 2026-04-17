import { Avatar, AvatarFallback } from "./ui/avatar";
import { cn, stripFrontmatter } from "../lib/utils";

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

/**
 * Build the avatar initials for a speaker label. Caps at 2 chars.
 *  - "Me" → "ME"
 *  - "Others" → "O"
 *  - "Mitra Patel" → "MP"
 */
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

/**
 * Stable color mapping per speaker label. Hardcoded for the two speakers the
 * engine emits today; falls back to a hashed palette for future diarized names.
 */
export function speakerStyles(name: string): { fallback: string } {
  if (name === "Me") return { fallback: "bg-blue-100 text-blue-700" };
  if (name === "Others") return { fallback: "bg-emerald-100 text-emerald-700" };

  // Simple stable hash so the same name always lands on the same palette slot.
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return SPEAKER_PALETTE[hash % SPEAKER_PALETTE.length];
}

export function TranscriptView({ source }: { source: string }) {
  const groups = parseTranscriptGroups(source);

  if (groups.length === 0) {
    return (
      <div className="text-sm text-[var(--text-secondary)]">
        Transcript unavailable.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group, groupIndex) => (
        <div key={groupIndex} className="flex gap-4">
          {group.speaker ? (
            <div className="flex-shrink-0 mt-1">
              <Avatar className="h-9 w-9">
                <AvatarFallback
                  className={cn(
                    "text-xs font-medium",
                    speakerStyles(group.speaker).fallback
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
                {group.firstTimestamp ? (
                  <span className="font-mono text-xs text-[var(--text-tertiary)]">
                    {group.firstTimestamp}
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-2 text-base leading-relaxed text-[var(--text-primary)]">
              {group.entries.map((entry, entryIndex) => (
                <p
                  key={entryIndex}
                  className="whitespace-pre-wrap break-words"
                  title={entry.timestamp ?? undefined}
                >
                  {entry.text}
                </p>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
