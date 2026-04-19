/**
 * Shared types for the chat retrieval layer. Pure types only — no runtime
 * dependencies on DB or HTTP clients so this module imports cleanly from
 * both engine and app.
 */

export type ChunkKind = "transcript" | "summary" | "prep" | "notes";

export type RunStatus = "past" | "upcoming";

export type CitationSource = "transcript" | "summary" | "prep" | "notes";

/**
 * One retrievable chunk of a meeting, pre-insertion. The DB-assigned
 * `chunk_id` is added when the store writes the row.
 */
export interface ChunkInput {
  kind: ChunkKind;
  speaker: "me" | "others" | "unknown" | null;
  start_ms: number | null;
  end_ms: number | null;
  text: string;
  seekable: boolean;
}

/**
 * A retrieved chunk with ranking metadata. This is what search_meetings
 * returns and what the retrieval-assistant loop hands to the LLM.
 */
export interface SearchResult {
  run_id: string;
  run_title: string;
  run_date: string;
  run_status: RunStatus;
  chunk_id: number;
  kind: ChunkKind;
  speaker: string | null;
  start_ms: number | null;
  end_ms: number | null;
  text: string;
  snippet: string;
  seekable: boolean;
  score: number;
  /** Optional: which participants were on this run — surfaces for the LLM. */
  participants: string[];
}

export interface SearchFilters {
  date_range?: { from: string; to: string };
  status?: RunStatus | "any";
  participant?: string;
}

/**
 * Stable citation shape persisted with each assistant message. Intentionally
 * excludes `chunk_id`, which is an implementation detail that changes on
 * reindex. `run_id` + `start_ms` (or `source` kind) are the stable fields.
 */
export interface StoredCitation {
  run_id: string;
  source: CitationSource;
  start_ms: number | null;
  end_ms: number | null;
  run_title_snapshot: string;
  run_date_snapshot: string;
}

export interface ChatThread {
  thread_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  model_id: string | null;
}

export interface ChatMessage {
  message_id: string;
  thread_id: string;
  role: "user" | "assistant";
  content: string;
  citations: StoredCitation[];
  created_at: string;
}
