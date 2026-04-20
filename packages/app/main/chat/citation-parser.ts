import type { SearchResult, StoredCitation } from "@gistlist/engine";

/**
 * Wire form used by the assistant:
 *   [[cite:<run_id>:<start_ms>]]        for seekable transcript segments
 *   [[cite:<run_id>:<kind>]]            for non-timestamped sources
 *                                       (kind ∈ summary|prep|notes|transcript)
 *
 * run_id contains letters, numbers, dashes, and underscores (ULIDs in this
 * codebase). start_ms is a positive integer; kind is a lowercase word.
 */
const CITATION_RE = /\[\[cite:([A-Za-z0-9_-]+):([A-Za-z0-9]+)\]\]/g;

export interface ParsedCitation {
  rawMatch: string;
  run_id: string;
  /** Either a numeric ms timestamp or a source-kind token. */
  ref: string;
}

export function parseCitationMarkers(text: string): ParsedCitation[] {
  const out: ParsedCitation[] = [];
  let match: RegExpExecArray | null;
  CITATION_RE.lastIndex = 0;
  while ((match = CITATION_RE.exec(text)) !== null) {
    out.push({ rawMatch: match[0], run_id: match[1], ref: match[2] });
  }
  return out;
}

/**
 * Build `StoredCitation[]` by joining parsed markers against the retrieval
 * results already in scope. Citations that don't match any run in scope are
 * dropped (the cited-run whitelist rule) — the caller should log these.
 */
export function buildStoredCitations(
  text: string,
  inScope: SearchResult[]
): { citations: StoredCitation[]; strippedInvalid: number } {
  const parsed = parseCitationMarkers(text);
  const byRunId = new Map<string, SearchResult[]>();
  for (const r of inScope) {
    const arr = byRunId.get(r.run_id);
    if (arr) arr.push(r);
    else byRunId.set(r.run_id, [r]);
  }

  const seen = new Set<string>();
  const out: StoredCitation[] = [];
  let stripped = 0;

  for (const p of parsed) {
    const key = `${p.run_id}:${p.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const candidates = byRunId.get(p.run_id);
    if (!candidates || candidates.length === 0) {
      stripped += 1;
      continue;
    }

    const asNumber = Number(p.ref);
    let storedCitation: StoredCitation;
    if (Number.isFinite(asNumber) && !/^[a-z]/i.test(p.ref)) {
      // start_ms citation — pick the candidate whose start_ms is closest,
      // matching a seekable transcript chunk.
      const ms = asNumber;
      const transcriptHits = candidates.filter((c) => c.kind === "transcript");
      const best = transcriptHits.length > 0 ? transcriptHits : candidates;
      best.sort(
        (a, b) =>
          Math.abs((a.start_ms ?? 0) - ms) - Math.abs((b.start_ms ?? 0) - ms)
      );
      const pick = best[0];
      storedCitation = {
        run_id: p.run_id,
        source: pick.kind === "transcript" ? "transcript" : pick.kind,
        start_ms: ms,
        end_ms: pick.end_ms,
        run_title_snapshot: pick.run_title,
        run_date_snapshot: pick.run_date,
      };
    } else {
      // Kind-based citation — look for a matching chunk of that kind.
      const kind = p.ref.toLowerCase() as StoredCitation["source"];
      const matching = candidates.find((c) => c.kind === kind) ?? candidates[0];
      storedCitation = {
        run_id: p.run_id,
        source: (matching.kind === "transcript" ? "transcript" : matching.kind) as StoredCitation["source"],
        start_ms: null,
        end_ms: null,
        run_title_snapshot: matching.run_title,
        run_date_snapshot: matching.run_date,
      };
    }

    out.push(storedCitation);
  }

  return { citations: out, strippedInvalid: stripped };
}

/** Remove any invalid `[[cite:...]]` markers (those not in scope). */
export function stripInvalidCitations(
  text: string,
  inScope: SearchResult[]
): string {
  const validRuns = new Set(inScope.map((r) => r.run_id));
  return text.replace(CITATION_RE, (full, runId: string) =>
    validRuns.has(runId) ? full : ""
  );
}
