/**
 * Pure helpers for transcript search: match indexing + highlight splitting.
 * Kept in `shared/` so unit tests can import them via node's test runner.
 */

export interface SearchableEntry {
  groupIndex: number;
  entryIndex: number;
  text: string;
}

export interface EntryMatch {
  /** Index of the speaker group in the flat groups array. */
  groupIndex: number;
  /** Index of the entry inside that group. */
  entryIndex: number;
  /** Zero-based index of this match within the flat match list. */
  matchIndex: number;
  /** Character offset inside `entry.text` where this match starts. */
  start: number;
  /** Exclusive end offset inside `entry.text`. */
  end: number;
}

export interface HighlightSegment {
  text: string;
  highlighted: boolean;
}

/**
 * Build a flat, ordered list of match tuples across all entries for a given
 * query. Case-insensitive literal substring search; empty query returns `[]`.
 * Stable across renders as long as `entries` + `query` are unchanged, so
 * prev/next navigation can index into it directly without any DOM queries.
 */
export function buildMatches(
  entries: ReadonlyArray<SearchableEntry>,
  query: string,
): EntryMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const out: EntryMatch[] = [];
  let matchIndex = 0;
  for (const entry of entries) {
    const haystack = entry.text.toLowerCase();
    let from = 0;
    while (from <= haystack.length) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) break;
      out.push({
        groupIndex: entry.groupIndex,
        entryIndex: entry.entryIndex,
        matchIndex: matchIndex++,
        start: at,
        end: at + needle.length,
      });
      from = at + Math.max(needle.length, 1);
    }
  }
  return out;
}

/**
 * Split a text into alternating highlighted / non-highlighted segments for
 * rendering. Empty query yields a single non-highlighted segment. No regex,
 * no escaping — literal case-insensitive matching only.
 */
export function splitWithHighlights(text: string, query: string): HighlightSegment[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [{ text, highlighted: false }];
  const haystack = text.toLowerCase();
  const out: HighlightSegment[] = [];
  let cursor = 0;
  while (cursor <= haystack.length) {
    const at = haystack.indexOf(needle, cursor);
    if (at === -1) {
      if (cursor < text.length) out.push({ text: text.slice(cursor), highlighted: false });
      break;
    }
    if (at > cursor) out.push({ text: text.slice(cursor, at), highlighted: false });
    out.push({ text: text.slice(at, at + needle.length), highlighted: true });
    cursor = at + Math.max(needle.length, 1);
  }
  return out;
}

/**
 * True when an entry at (groupIndex, entryIndex) has at least one match in
 * the provided match list. O(1) per lookup using a precomputed Set key.
 */
export function buildEntryMatchSet(matches: ReadonlyArray<EntryMatch>): Set<string> {
  const out = new Set<string>();
  for (const m of matches) out.add(`${m.groupIndex}:${m.entryIndex}`);
  return out;
}

export function entryKey(groupIndex: number, entryIndex: number): string {
  return `${groupIndex}:${entryIndex}`;
}
