import { stripFrontmatter } from "../lib/utils";

interface TranscriptEntry {
  timestamp: string | null;
  text: string;
}

export function TranscriptView({ source }: { source: string }) {
  const lines = stripFrontmatter(source)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const groups: Array<{ heading?: string; entries: TranscriptEntry[] }> = [];
  let current = { heading: undefined as string | undefined, entries: [] as TranscriptEntry[] };

  for (const line of lines) {
    if (line.startsWith("### ")) {
      if (current.heading || current.entries.length > 0) groups.push(current);
      current = { heading: line.slice(4), entries: [] };
      continue;
    }

    const match = line.match(/^`(\d{2}:\d{2})`\s+(.*)$/);
    current.entries.push({
      timestamp: match?.[1] ?? null,
      text: match?.[2] ?? line,
    });
  }

  if (current.heading || current.entries.length > 0) groups.push(current);

  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border-default)] bg-white p-6 text-sm text-[var(--text-secondary)] shadow-sm">
        Transcript unavailable.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {groups.map((group, index) => (
        <div
          key={`${group.heading ?? "group"}-${index}`}
          className="rounded-lg border border-[var(--border-default)] bg-white p-5 shadow-sm"
        >
          {group.heading ? (
            <div className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
              {group.heading}
            </div>
          ) : null}
          <div className="space-y-3">
            {group.entries.map((entry, entryIndex) => (
              <div
                key={`${entry.timestamp ?? "plain"}-${entryIndex}`}
                className="grid gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3 md:grid-cols-[72px_minmax(0,1fr)] md:gap-4"
              >
                <div className="font-mono text-xs font-semibold text-[var(--accent)]">
                  {entry.timestamp ?? "—"}
                </div>
                <div className="whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text-primary)]">
                  {entry.text}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
