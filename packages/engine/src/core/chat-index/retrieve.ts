import type Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { SearchFilters, SearchResult } from "./types.js";

const TOP_K_PER_LEG = 20;
const DEFAULT_LIMIT = 8;
const RRF_K = 60;

export interface SearchOptions extends SearchFilters {
  limit?: number;
  /** Caller supplies the embedder; retrieval doesn't own embedder state. */
  queryEmbedder?: (query: string) => Promise<number[] | null>;
  /**
   * Returns true when sqlite-vec is loaded and `chat_chunks_vec` is queryable.
   * Evaluated *after* `awaitVec` resolves so cold-start callers get the
   * post-load value, not a stale snapshot. Defaults to "vec unavailable" so
   * consumers must opt in.
   */
  isVecAvailable?: () => boolean;
  /**
   * Awaits any in-flight vec extension load. Called once before vec
   * availability is evaluated so cold-start retrieval doesn't race the
   * loader. Optional.
   */
  awaitVec?: () => Promise<void>;
}

/**
 * Hybrid search over `chat_chunks`. Runs FTS and vector legs in parallel,
 * merges via Reciprocal Rank Fusion, joins with the runs table for
 * title/date/status, applies filters, and returns top-K with snippet.
 * Falls back to FTS-only when the vec extension isn't available.
 */
export async function searchMeetings(
  db: Database.Database,
  query: string,
  opts: SearchOptions = {}
): Promise<SearchResult[]> {
  if (opts.awaitVec) await opts.awaitVec();
  const vecAvailable = opts.isVecAvailable ? opts.isVecAvailable() : false;
  const limit = opts.limit ?? DEFAULT_LIMIT;

  const ftsRanked = runFtsLeg(db, query);

  let vecRanked: Array<{ chunk_id: number; rank: number }> = [];
  if (vecAvailable && opts.queryEmbedder) {
    try {
      const qVec = await opts.queryEmbedder(query);
      if (qVec) vecRanked = runVecLeg(db, qVec);
    } catch {
      // Embedder failure (Ollama down, model unavailable) → quiet FTS-only.
      vecRanked = [];
    }
  }

  // RRF merge.
  const scores = new Map<number, number>();
  for (let i = 0; i < ftsRanked.length; i++) {
    const id = ftsRanked[i].chunk_id;
    scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + i + 1));
  }
  for (let i = 0; i < vecRanked.length; i++) {
    const id = vecRanked[i].chunk_id;
    scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + i + 1));
  }

  if (scores.size === 0) return [];

  const candidateIds = Array.from(scores.keys());
  const rows = hydrateChunks(db, candidateIds);

  const results: SearchResult[] = rows
    .map((row) => {
      const score = scores.get(row.chunk_id) ?? 0;
      const status: SearchResult["run_status"] = row.scheduled_time
        ? row.scheduled_time > new Date().toISOString()
          ? "upcoming"
          : "past"
        : "past";
      const participants = participantsForRun(db, row.run_id);
      return {
        run_id: row.run_id,
        run_title: row.run_title,
        run_date: row.run_date,
        run_status: status,
        chunk_id: row.chunk_id,
        kind: row.kind,
        speaker: row.speaker,
        start_ms: row.start_ms,
        end_ms: row.end_ms,
        text: row.text,
        snippet: buildSnippet(row.text, query),
        seekable: row.seekable === 1,
        score,
        participants,
      };
    })
    .filter((r) => passesFilters(r, opts));

  results.sort((a, b) => {
    // Preserve transcript-first ordering when results are tied by score.
    if (b.score !== a.score) return b.score - a.score;
    const kindOrder = { transcript: 0, summary: 1, prep: 2, notes: 3 } as const;
    return kindOrder[a.kind] - kindOrder[b.kind];
  });

  return results.slice(0, limit);
}

function runFtsLeg(
  db: Database.Database,
  query: string
): Array<{ chunk_id: number; rank: number }> {
  const sanitized = sanitizeFtsQuery(query);
  if (!sanitized) return [];
  try {
    const rows = db
      .prepare(
        `SELECT rowid AS chunk_id, bm25(chat_chunks_fts) AS rank
         FROM chat_chunks_fts
         WHERE chat_chunks_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
      )
      .all(sanitized, TOP_K_PER_LEG) as Array<{ chunk_id: number; rank: number }>;
    return rows;
  } catch {
    return [];
  }
}

function runVecLeg(
  db: Database.Database,
  queryVec: number[]
): Array<{ chunk_id: number; rank: number }> {
  try {
    const buf = Buffer.from(new Float32Array(queryVec).buffer);
    const rows = db
      .prepare(
        `SELECT rowid AS chunk_id, distance
         FROM chat_chunks_vec
         WHERE embedding MATCH ? AND k = ?
         ORDER BY distance`
      )
      .all(buf, TOP_K_PER_LEG) as Array<{ chunk_id: number | bigint; distance: number }>;
    return rows.map((r) => ({ chunk_id: Number(r.chunk_id), rank: r.distance }));
  } catch {
    return [];
  }
}

interface HydratedRow {
  chunk_id: number;
  run_id: string;
  run_title: string;
  run_date: string;
  scheduled_time: string | null;
  kind: SearchResult["kind"];
  speaker: string | null;
  start_ms: number | null;
  end_ms: number | null;
  text: string;
  seekable: number;
}

function hydrateChunks(db: Database.Database, ids: number[]): HydratedRow[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT c.chunk_id, c.run_id, r.title AS run_title, r.date AS run_date,
              r.scheduled_time, c.kind, c.speaker, c.start_ms, c.end_ms,
              c.text, c.seekable
       FROM chat_chunks c
       INNER JOIN runs r ON r.run_id = c.run_id
       WHERE c.chunk_id IN (${placeholders})`
    )
    .all(...ids) as HydratedRow[];
  return rows;
}

function participantsForRun(db: Database.Database, runId: string): string[] {
  try {
    const rows = db
      .prepare(
        `SELECT COALESCE(p.first_name || ' ' || p.last_name, p.first_name, p.email, '') AS label
         FROM run_participants rp
         INNER JOIN participants p ON p.participant_id = rp.participant_id
         WHERE rp.run_id = ?`
      )
      .all(runId) as Array<{ label: string }>;
    return rows.map((r) => r.label.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function passesFilters(r: SearchResult, opts: SearchOptions): boolean {
  if (opts.date_range) {
    if (r.run_date < opts.date_range.from || r.run_date > opts.date_range.to) {
      return false;
    }
  }
  if (opts.status && opts.status !== "any") {
    if (r.run_status !== opts.status) return false;
  }
  if (opts.participant) {
    const needle = opts.participant.toLowerCase();
    // Match against structured participants first; fall back to the
    // meeting title since many imported/auto-recorded meetings never get
    // a proper participants list populated but do have the person's name
    // in the title (e.g. "Lauren Dai catchup").
    const hitParticipant = r.participants.some((p) =>
      p.toLowerCase().includes(needle),
    );
    const hitTitle = r.run_title.toLowerCase().includes(needle);
    if (!hitParticipant && !hitTitle) return false;
  }
  return true;
}

/**
 * Escape FTS5 special characters and wrap tokens so quotes work. Simple
 * approach: strip control chars, split on whitespace, quote each token.
 * Drops 1-char tokens (FTS5 needs ≥3 chars to match anything useful).
 */
function sanitizeFtsQuery(q: string): string {
  const tokens = q
    .toLowerCase()
    .replace(/["'`]/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return "";
  // OR-join so we get fuzzy recall, mirroring how FTS is typically used
  // for search-assistance rather than exact phrase match.
  return tokens.map((t) => `"${t}"`).join(" OR ");
}

function buildSnippet(text: string, query: string): string {
  const lowered = text.toLowerCase();
  const needle = query.toLowerCase().split(/\s+/).find((t) => t.length >= 3);
  if (!needle) return text.slice(0, 600);
  const idx = lowered.indexOf(needle);
  if (idx === -1) return text.slice(0, 600);
  const start = Math.max(0, idx - 150);
  const end = Math.min(text.length, idx + 450);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

export interface MeetingSummary {
  run_id: string;
  title: string;
  date: string;
  participants: string[];
  summary_md: string | null;
}

export function getMeetingSummaryByRunId(
  db: Database.Database,
  runId: string
): MeetingSummary | null {
  const row = db
    .prepare("SELECT run_id, title, date, folder_path FROM runs WHERE run_id = ?")
    .get(runId) as { run_id: string; title: string; date: string; folder_path: string } | undefined;
  if (!row) return null;
  const participants = participantsForRun(db, row.run_id);

  // Look for a summary.md in the run folder. Indexed separately, but the
  // assistant may also want the full text.
  let summary_md: string | null = null;
  try {
    const p = path.join(row.folder_path, "summary.md");
    if (fs.existsSync(p)) summary_md = fs.readFileSync(p, "utf-8");
  } catch {
    // Best-effort.
  }

  return { run_id: row.run_id, title: row.title, date: row.date, participants, summary_md };
}

export interface TranscriptWindow {
  text: string;
  segments: Array<{
    speaker: string | null;
    start_ms: number;
    end_ms: number;
    text: string;
  }>;
}

export function getTranscriptWindow(
  db: Database.Database,
  runId: string,
  startMs: number,
  windowMs = 60_000
): TranscriptWindow {
  const rows = db
    .prepare(
      `SELECT speaker, start_ms, end_ms, text
       FROM chat_chunks
       WHERE run_id = ? AND kind = 'transcript'
         AND end_ms >= ? AND start_ms <= ?
       ORDER BY start_ms ASC`
    )
    .all(runId, startMs, startMs + windowMs) as Array<{
    speaker: string | null;
    start_ms: number;
    end_ms: number;
    text: string;
  }>;
  return {
    text: rows.map((r) => r.text).join(" ").trim(),
    segments: rows,
  };
}

export interface MeetingListRow {
  run_id: string;
  run_title: string;
  run_date: string;
  run_status: "past" | "upcoming";
  participants: string[];
}

export function listMeetings(
  db: Database.Database,
  filters: SearchFilters = {},
  limit = 50
): MeetingListRow[] {
  const rows = db
    .prepare(
      `SELECT run_id, title AS run_title, date AS run_date, scheduled_time
       FROM runs
       ORDER BY date DESC
       LIMIT ?`
    )
    .all(Math.max(1, limit * 3)) as Array<{
    run_id: string;
    run_title: string;
    run_date: string;
    scheduled_time: string | null;
  }>;
  const now = new Date().toISOString();
  const hydrated: MeetingListRow[] = rows.map((r) => ({
    run_id: r.run_id,
    run_title: r.run_title,
    run_date: r.run_date,
    run_status:
      r.scheduled_time && r.scheduled_time > now ? "upcoming" : "past",
    participants: participantsForRun(db, r.run_id),
  }));
  return hydrated
    .filter((r) => {
      if (filters.date_range) {
        if (r.run_date < filters.date_range.from || r.run_date > filters.date_range.to) {
          return false;
        }
      }
      if (filters.status && filters.status !== "any") {
        if (r.run_status !== filters.status) return false;
      }
      if (filters.participant) {
        const needle = filters.participant.toLowerCase();
        if (!r.participants.some((p) => p.toLowerCase().includes(needle))) return false;
      }
      return true;
    })
    .slice(0, limit);
}
