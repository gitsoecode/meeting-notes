/**
 * Thin app-side adapter over the engine's chat-index retrieval functions.
 * The retrieval logic itself lives in `@gistlist/engine` so the MCP server
 * (and any other consumer) can reuse it. This module wires the engine
 * functions to the app's singleton DB connection and the app's sqlite-vec
 * loader state.
 */
import {
  searchMeetings as engineSearchMeetings,
  getMeetingSummaryByRunId as engineGetMeetingSummaryByRunId,
  getTranscriptWindow as engineGetTranscriptWindow,
  listMeetings as engineListMeetings,
  type SearchOptions as EngineSearchOptions,
  type MeetingListRow,
  type MeetingSummary,
  type SearchFilters,
  type SearchResult,
  type TranscriptWindow,
} from "@gistlist/engine";
import { awaitSqliteVec, getDb } from "../db/connection.js";
import { isVecAvailable } from "../db/sqlite-vec-loader.js";

/**
 * App-facing options. Mirrors the engine shape but omits the DB-handle and
 * vec-availability fields, which the adapter supplies from app singletons.
 */
export interface SearchOptions extends SearchFilters {
  limit?: number;
  queryEmbedder?: (query: string) => Promise<number[] | null>;
}

export type { MeetingListRow, MeetingSummary, TranscriptWindow };

export async function searchMeetings(
  query: string,
  opts: SearchOptions = {}
): Promise<SearchResult[]> {
  const engineOpts: EngineSearchOptions = {
    ...opts,
    // Pass a callback (not a snapshot) so the engine can evaluate vec
    // availability *after* awaiting the loader — preserves the original
    // cold-start behavior where the first call after app launch waits for
    // sqlite-vec to finish loading and then uses the vec leg.
    isVecAvailable,
    awaitVec: awaitSqliteVec,
  };
  return engineSearchMeetings(getDb(), query, engineOpts);
}

export function getMeetingSummaryByRunId(runId: string): MeetingSummary | null {
  return engineGetMeetingSummaryByRunId(getDb(), runId);
}

export function getTranscriptWindow(
  runId: string,
  startMs: number,
  windowMs = 60_000
): TranscriptWindow {
  return engineGetTranscriptWindow(getDb(), runId, startMs, windowMs);
}

export function listMeetings(
  filters: SearchFilters = {},
  limit = 50
): MeetingListRow[] {
  return engineListMeetings(getDb(), filters, limit);
}
