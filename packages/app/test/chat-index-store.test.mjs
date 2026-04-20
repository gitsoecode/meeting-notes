import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";

// `better-sqlite3` is a native ESM-incompatible module; use a CJS require()
// to load it from the already-installed node_modules.
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const {
  SCHEMA_V1,
  SCHEMA_V4_CHAT,
} = await import(new URL("../dist/main/db/schema.js", import.meta.url).href);

const {
  clearRunChunks,
  insertRunChunks,
  countRunChunks,
  getEmbeddingModelMeta,
  setEmbeddingModelMeta,
} = await import(new URL("../dist/main/chat-index/store.js", import.meta.url).href);

function makeDb() {
  // In-memory sqlite so we don't touch the user's real ~/.gistlist/meetings.db.
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_V1);
  db.exec(SCHEMA_V4_CHAT);

  // Seed one run so chat_chunks foreign-key constraint is satisfied.
  db.prepare(
    `INSERT INTO runs (run_id, folder_path, title, description, date, started, status, source_mode, asr_provider, llm_provider, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "RUN_TEST",
    "/tmp/fake/runs/RUN_TEST",
    "Catch up with Lauren",
    null,
    "2026-02-10",
    "2026-02-10T15:00:00Z",
    "complete",
    "both",
    "parakeet-mlx",
    "ollama",
    "2026-02-10T15:30:00Z"
  );

  return db;
}

test("insertRunChunks writes chunks and keeps FTS in sync", () => {
  const db = makeDb();
  const chunks = [
    {
      kind: "transcript",
      speaker: "me",
      start_ms: 0,
      end_ms: 10_000,
      text: "We talked about pricing strategy with Lauren.",
      seekable: true,
    },
    {
      kind: "summary",
      speaker: null,
      start_ms: null,
      end_ms: null,
      text: "Pricing discussion summary.",
      seekable: false,
    },
  ];
  const ids = insertRunChunks(db, "RUN_TEST", chunks, null);
  assert.equal(ids.length, 2);
  assert.equal(countRunChunks(db, "RUN_TEST"), 2);

  const ftsMatches = db
    .prepare(
      `SELECT rowid AS chunk_id FROM chat_chunks_fts WHERE chat_chunks_fts MATCH ? ORDER BY rowid`
    )
    .all("pricing");
  assert.equal(ftsMatches.length, 2);
});

test("clearRunChunks removes all chunks for a run and cascades FTS", () => {
  const db = makeDb();
  insertRunChunks(
    db,
    "RUN_TEST",
    [
      {
        kind: "transcript",
        speaker: "me",
        start_ms: 0,
        end_ms: 1000,
        text: "hello",
        seekable: true,
      },
    ],
    null
  );
  assert.equal(countRunChunks(db, "RUN_TEST"), 1);
  clearRunChunks(db, "RUN_TEST");
  assert.equal(countRunChunks(db, "RUN_TEST"), 0);
  const fts = db
    .prepare(`SELECT rowid AS chunk_id FROM chat_chunks_fts WHERE chat_chunks_fts MATCH ?`)
    .all("hello");
  assert.equal(fts.length, 0);
});

test("run deletion cascades chat_chunks", () => {
  const db = makeDb();
  insertRunChunks(
    db,
    "RUN_TEST",
    [
      {
        kind: "transcript",
        speaker: "me",
        start_ms: 0,
        end_ms: 1000,
        text: "hello",
        seekable: true,
      },
    ],
    null
  );
  db.prepare("DELETE FROM runs WHERE run_id = ?").run("RUN_TEST");
  assert.equal(countRunChunks(db, "RUN_TEST"), 0);
});

test("embedding model meta round-trips", () => {
  const db = makeDb();
  assert.equal(getEmbeddingModelMeta(db), null);
  setEmbeddingModelMeta(db, "nomic-embed-text");
  assert.equal(getEmbeddingModelMeta(db), "nomic-embed-text");
  setEmbeddingModelMeta(db, "mxbai-embed-large");
  assert.equal(getEmbeddingModelMeta(db), "mxbai-embed-large");
});
