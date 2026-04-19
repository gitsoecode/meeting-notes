/** SQLite schema v1 for Meeting Notes. */
export const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS runs (
  run_id           TEXT PRIMARY KEY,
  folder_path      TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  description      TEXT,
  date             TEXT NOT NULL,
  started          TEXT NOT NULL,
  ended            TEXT,
  status           TEXT NOT NULL DEFAULT 'draft',
  source_mode      TEXT NOT NULL DEFAULT 'both',
  duration_minutes REAL,
  asr_provider     TEXT NOT NULL DEFAULT '',
  llm_provider     TEXT NOT NULL DEFAULT '',
  scheduled_time   TEXT,
  selected_prompts TEXT,
  updated_at       TEXT
);

CREATE TABLE IF NOT EXISTS prompt_outputs (
  run_id           TEXT NOT NULL,
  prompt_output_id TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',
  filename         TEXT NOT NULL,
  label            TEXT,
  builtin          INTEGER DEFAULT 0,
  error            TEXT,
  latency_ms       INTEGER,
  tokens_used      INTEGER,
  completed_at     TEXT,
  PRIMARY KEY (run_id, prompt_output_id),
  FOREIGN KEY (run_id) REFERENCES runs(run_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tags (
  run_id TEXT NOT NULL,
  tag    TEXT NOT NULL,
  PRIMARY KEY (run_id, tag),
  FOREIGN KEY (run_id) REFERENCES runs(run_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS participants (
  participant_id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name     TEXT,
  last_name      TEXT,
  email          TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS run_participants (
  run_id         TEXT NOT NULL,
  participant_id INTEGER NOT NULL,
  PRIMARY KEY (run_id, participant_id),
  FOREIGN KEY (run_id) REFERENCES runs(run_id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(participant_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attachments (
  run_id   TEXT NOT NULL,
  filename TEXT NOT NULL,
  PRIMARY KEY (run_id, filename),
  FOREIGN KEY (run_id) REFERENCES runs(run_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS recording_segments (
  run_id       TEXT NOT NULL,
  segment_name TEXT NOT NULL,
  sort_order   INTEGER DEFAULT 0,
  PRIMARY KEY (run_id, segment_name),
  FOREIGN KEY (run_id) REFERENCES runs(run_id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_runs_folder_path ON runs(folder_path);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_date ON runs(date DESC);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status_started ON runs(status, started DESC);
CREATE INDEX IF NOT EXISTS idx_runs_updated_at ON runs(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_participants_email ON participants(email);
CREATE INDEX IF NOT EXISTS idx_prompt_outputs_run ON prompt_outputs(run_id, status);

-- Full-text search on meeting titles and descriptions
CREATE VIRTUAL TABLE IF NOT EXISTS runs_fts USING fts5(
  title,
  description,
  content='runs',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS runs_fts_insert AFTER INSERT ON runs BEGIN
  INSERT INTO runs_fts(rowid, title, description) VALUES (NEW.rowid, NEW.title, NEW.description);
END;

CREATE TRIGGER IF NOT EXISTS runs_fts_delete AFTER DELETE ON runs BEGIN
  INSERT INTO runs_fts(runs_fts, rowid, title, description) VALUES ('delete', OLD.rowid, OLD.title, OLD.description);
END;

CREATE TRIGGER IF NOT EXISTS runs_fts_update AFTER UPDATE OF title, description ON runs BEGIN
  INSERT INTO runs_fts(runs_fts, rowid, title, description) VALUES ('delete', OLD.rowid, OLD.title, OLD.description);
  INSERT INTO runs_fts(rowid, title, description) VALUES (NEW.rowid, NEW.title, NEW.description);
END;
`;

/**
 * Chat-index schema (v4). Adds hybrid retrieval tables for the chat assistant:
 * - `chat_chunks`: one row per retrievable chunk (transcript segment, summary
 *   section, prep/notes excerpt). Cascades on run deletion.
 * - `chat_chunks_fts`: FTS5 contentless mirror, kept in sync via triggers.
 * - `chat_index_meta`: small key/value table recording which embedding model
 *   produced the current vectors; mismatch triggers a re-embed on startup.
 * - `chat_threads` + `chat_messages`: chat conversation history, per-thread.
 *
 * Note: `chat_chunks_vec` (sqlite-vec vec0 virtual table) is created by the
 * sqlite-vec loader after the extension is loaded — it can't live in this
 * static SQL string because the extension isn't loaded at migration time on
 * pre-existing databases.
 */
export const SCHEMA_V4_CHAT = `
CREATE TABLE IF NOT EXISTS chat_chunks (
  chunk_id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id           TEXT NOT NULL,
  kind             TEXT NOT NULL,
  speaker          TEXT,
  start_ms         INTEGER,
  end_ms           INTEGER,
  text             TEXT NOT NULL,
  seekable         INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (run_id) REFERENCES runs(run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_chunks_run ON chat_chunks(run_id);
CREATE INDEX IF NOT EXISTS idx_chat_chunks_run_start ON chat_chunks(run_id, start_ms);

-- Standalone FTS5 table (not contentless). Stores a second copy of text —
-- wasteful but trivial at the scale we index. Avoids the fragile
-- content_rowid wiring against chat_chunks. chunk_id is the primary key
-- INTEGER of chat_chunks, which is an alias for rowid; we reuse it as the
-- FTS rowid so the two tables share IDs.
CREATE VIRTUAL TABLE IF NOT EXISTS chat_chunks_fts USING fts5(
  text,
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS chat_chunks_fts_insert AFTER INSERT ON chat_chunks BEGIN
  INSERT INTO chat_chunks_fts(rowid, text) VALUES (NEW.chunk_id, NEW.text);
END;

CREATE TRIGGER IF NOT EXISTS chat_chunks_fts_delete AFTER DELETE ON chat_chunks BEGIN
  DELETE FROM chat_chunks_fts WHERE rowid = OLD.chunk_id;
END;

CREATE TRIGGER IF NOT EXISTS chat_chunks_fts_update AFTER UPDATE OF text ON chat_chunks BEGIN
  DELETE FROM chat_chunks_fts WHERE rowid = OLD.chunk_id;
  INSERT INTO chat_chunks_fts(rowid, text) VALUES (NEW.chunk_id, NEW.text);
END;

CREATE TABLE IF NOT EXISTS chat_index_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_threads (
  thread_id   TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  model_id    TEXT
);

CREATE INDEX IF NOT EXISTS idx_chat_threads_updated ON chat_threads(updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  message_id   TEXT PRIMARY KEY,
  thread_id    TEXT NOT NULL,
  role         TEXT NOT NULL,
  content      TEXT NOT NULL,
  citations    TEXT,
  created_at   TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES chat_threads(thread_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id, created_at);
`;

/**
 * The sqlite-vec vec0 virtual table, created after the extension is loaded.
 * Parameterized on embedding dimension so we can swap models. Uses the
 * implicit `rowid` as the key — sqlite-vec rejects named INTEGER PRIMARY
 * KEY columns when Node bindings pass regular numbers, and the implicit
 * rowid works cleanly with BigInt-bound inserts.
 */
export function chatChunksVecSchema(dim: number): string {
  return `CREATE VIRTUAL TABLE IF NOT EXISTS chat_chunks_vec USING vec0(
    embedding FLOAT[${dim}]
  );`;
}
