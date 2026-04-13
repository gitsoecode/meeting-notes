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
