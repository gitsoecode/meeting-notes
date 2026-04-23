import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// `better-sqlite3` is a native CJS module — load via createRequire from the
// hoisted root node_modules.
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const {
  searchMeetings,
  listMeetings,
  getTranscriptWindow,
  getMeetingSummaryByRunId,
} = await import(
  new URL("../dist/core/chat-index/retrieve.js", import.meta.url).href
);

// Minimal schema covering exactly what retrieve touches. The app owns the
// canonical schema; this is a test fixture deliberately kept lean. If the
// real schema diverges in a way that breaks retrieve, the app-side
// chat-index-store.test catches it.
const SCHEMA = `
CREATE TABLE runs (
  run_id           TEXT PRIMARY KEY,
  folder_path      TEXT NOT NULL,
  title            TEXT NOT NULL,
  description      TEXT,
  date             TEXT NOT NULL,
  started          TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'complete',
  source_mode      TEXT NOT NULL DEFAULT 'both',
  duration_minutes REAL,
  asr_provider     TEXT NOT NULL DEFAULT '',
  llm_provider     TEXT NOT NULL DEFAULT '',
  scheduled_time   TEXT,
  selected_prompts TEXT,
  updated_at       TEXT
);

CREATE TABLE participants (
  participant_id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name     TEXT,
  last_name      TEXT,
  email          TEXT UNIQUE
);

CREATE TABLE run_participants (
  run_id         TEXT NOT NULL,
  participant_id INTEGER NOT NULL,
  PRIMARY KEY (run_id, participant_id)
);

CREATE TABLE chat_chunks (
  chunk_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id   TEXT NOT NULL,
  kind     TEXT NOT NULL,
  speaker  TEXT,
  start_ms INTEGER,
  end_ms   INTEGER,
  text     TEXT NOT NULL,
  seekable INTEGER NOT NULL DEFAULT 0
);

CREATE VIRTUAL TABLE chat_chunks_fts USING fts5(
  text,
  tokenize='porter unicode61'
);

CREATE TRIGGER chat_chunks_fts_insert AFTER INSERT ON chat_chunks BEGIN
  INSERT INTO chat_chunks_fts(rowid, text) VALUES (NEW.chunk_id, NEW.text);
END;
`;

function seedDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);

  // Two runs: one past, one upcoming; different participants.
  db.prepare(
    `INSERT INTO runs (run_id, folder_path, title, date, started, scheduled_time, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "RUN_PAST",
    "/tmp/runs/RUN_PAST",
    "Pricing sync with Clara",
    "2026-04-10",
    "2026-04-10T15:00:00Z",
    null,
    "2026-04-10T16:00:00Z"
  );
  db.prepare(
    `INSERT INTO runs (run_id, folder_path, title, date, started, scheduled_time, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "RUN_UPCOMING",
    "/tmp/runs/RUN_UPCOMING",
    "Quarterly review with Bob",
    "2026-12-01",
    "2026-12-01T15:00:00Z",
    "2026-12-01T15:00:00Z",
    "2026-04-12T16:00:00Z"
  );

  const insClara = db
    .prepare(
      `INSERT INTO participants (first_name, last_name, email) VALUES (?, ?, ?)`
    )
    .run("Clara", "Chen", "clara@example.com");
  db.prepare(
    `INSERT INTO run_participants (run_id, participant_id) VALUES (?, ?)`
  ).run("RUN_PAST", insClara.lastInsertRowid);

  const insBob = db
    .prepare(
      `INSERT INTO participants (first_name, last_name, email) VALUES (?, ?, ?)`
    )
    .run("Bob", "Smith", "bob@example.com");
  db.prepare(
    `INSERT INTO run_participants (run_id, participant_id) VALUES (?, ?)`
  ).run("RUN_UPCOMING", insBob.lastInsertRowid);

  // Chunks: a couple of transcript chunks on RUN_PAST, one summary on RUN_UPCOMING.
  const insChunk = db.prepare(
    `INSERT INTO chat_chunks (run_id, kind, speaker, start_ms, end_ms, text, seekable)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  insChunk.run("RUN_PAST", "transcript", "me", 0, 30_000, "We discussed pricing and the discount tier strategy.", 1);
  insChunk.run("RUN_PAST", "transcript", "others", 30_000, 60_000, "Clara mentioned a competitive pricing concern.", 1);
  insChunk.run("RUN_UPCOMING", "summary", null, null, null, "Quarterly metrics review with Bob next week.", 0);

  return db;
}

test("searchMeetings returns FTS-only hits when vecAvailable is false", async () => {
  const db = seedDb();
  const results = await searchMeetings(db, "pricing", { limit: 10 });

  assert.ok(results.length >= 1, "should find pricing-related chunks");
  assert.equal(results[0].run_id, "RUN_PAST");
  assert.equal(results[0].run_status, "past");
  assert.ok(results[0].snippet.toLowerCase().includes("pricing"));
});

test("searchMeetings status filter narrows to upcoming", async () => {
  const db = seedDb();
  const results = await searchMeetings(db, "review", { status: "upcoming", limit: 10 });

  assert.equal(results.length, 1);
  assert.equal(results[0].run_id, "RUN_UPCOMING");
  assert.equal(results[0].run_status, "upcoming");
});

test("searchMeetings participant filter matches by participant name", async () => {
  const db = seedDb();
  const results = await searchMeetings(db, "pricing", { participant: "Clara", limit: 10 });

  assert.ok(results.length >= 1);
  for (const r of results) assert.equal(r.run_id, "RUN_PAST");
});

test("searchMeetings participant filter falls back to title match", async () => {
  const db = seedDb();
  // No participant rows for a fictional "Steve", but search should still
  // match the meeting title if "Bob" appears there.
  const results = await searchMeetings(db, "review", { participant: "Bob", limit: 10 });
  assert.ok(results.length >= 1);
  assert.equal(results[0].run_id, "RUN_UPCOMING");
});

test("searchMeetings sanitizes punctuation and short tokens without throwing", async () => {
  const db = seedDb();
  const results = await searchMeetings(db, "?? a !!", { limit: 10 });
  // Sanitization drops these to nothing → FTS returns no hits, function returns [].
  assert.deepEqual(results, []);
});

test("searchMeetings does not call queryEmbedder when isVecAvailable is absent", async () => {
  const db = seedDb();
  let embedderCalled = false;
  await searchMeetings(db, "pricing", {
    limit: 10,
    queryEmbedder: async () => {
      embedderCalled = true;
      return null;
    },
  });
  assert.equal(embedderCalled, false);
});

test("searchMeetings evaluates isVecAvailable after awaitVec resolves", async () => {
  const db = seedDb();
  let vecLoaded = false;
  let isVecAvailableCalledBeforeAwait = false;
  let awaitResolved = false;
  await searchMeetings(db, "pricing", {
    limit: 10,
    awaitVec: async () => {
      // Simulate the loader finishing during the await.
      await new Promise((r) => setTimeout(r, 5));
      vecLoaded = true;
      awaitResolved = true;
    },
    isVecAvailable: () => {
      if (!awaitResolved) isVecAvailableCalledBeforeAwait = true;
      return vecLoaded;
    },
    queryEmbedder: async () => null,
  });
  assert.equal(
    isVecAvailableCalledBeforeAwait,
    false,
    "isVecAvailable must be evaluated only after awaitVec resolves"
  );
});

test("listMeetings returns runs ordered by date desc with status", () => {
  const db = seedDb();
  const rows = listMeetings(db, {}, 10);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].run_id, "RUN_UPCOMING");
  assert.equal(rows[0].run_status, "upcoming");
  assert.equal(rows[1].run_id, "RUN_PAST");
  assert.equal(rows[1].run_status, "past");
});

test("listMeetings filters by participant", () => {
  const db = seedDb();
  const rows = listMeetings(db, { participant: "Clara" }, 10);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].run_id, "RUN_PAST");
});

test("getTranscriptWindow returns chunks overlapping the window", () => {
  const db = seedDb();
  const w = getTranscriptWindow(db, "RUN_PAST", 0, 60_000);
  assert.equal(w.segments.length, 2);
  assert.match(w.text, /pricing/);
});

test("getMeetingSummaryByRunId returns row metadata even when summary file is missing", () => {
  const db = seedDb();
  const summary = getMeetingSummaryByRunId(db, "RUN_PAST");
  assert.ok(summary);
  assert.equal(summary.run_id, "RUN_PAST");
  assert.equal(summary.title, "Pricing sync with Clara");
  assert.equal(summary.summary_md, null); // /tmp/runs/RUN_PAST/summary.md doesn't exist
  assert.deepEqual(summary.participants, ["Clara Chen"]);
});

test("getMeetingSummaryByRunId returns null for unknown run", () => {
  const db = seedDb();
  const summary = getMeetingSummaryByRunId(db, "NOPE");
  assert.equal(summary, null);
});
