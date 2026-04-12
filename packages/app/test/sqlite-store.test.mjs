import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { SCHEMA_V1 } from "../dist/main/db/schema.js";
import { migrate, isEmptyDatabase } from "../dist/main/db/migrate.js";
import { SqliteRunStore } from "../dist/main/db/sqlite-run-store.js";

function createTestDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mn-sqlite-test-"));
  const dbPath = path.join(tmpDir, "test.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return { db, tmpDir };
}

function makeManifest(overrides = {}) {
  return {
    run_id: "test-run-1",
    title: "Test Meeting",
    description: "A test meeting",
    date: "2026-04-10",
    started: "2026-04-10T14:00:00.000Z",
    ended: null,
    status: "draft",
    source_mode: "both",
    tags: ["test", "dev"],
    participants: [],
    duration_minutes: null,
    asr_provider: "parakeet-mlx",
    llm_provider: "claude",
    prompt_outputs: {},
    scheduled_time: null,
    attachments: [],
    selected_prompts: null,
    recording_segments: [],
    ...overrides,
  };
}

test("migrate creates all tables and sets user_version", () => {
  const { db } = createTestDb();
  migrate(db);

  const version = db.pragma("user_version", { simple: true });
  assert.equal(version, 2);

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name);

  assert.ok(tables.includes("runs"));
  assert.ok(tables.includes("prompt_outputs"));
  assert.ok(tables.includes("tags"));
  assert.ok(tables.includes("participants"));
  assert.ok(tables.includes("run_participants"));
  assert.ok(tables.includes("attachments"));
  assert.ok(tables.includes("recording_segments"));
  db.close();
});

test("isEmptyDatabase returns true for fresh DB", () => {
  const { db } = createTestDb();
  migrate(db);
  assert.equal(isEmptyDatabase(db), true);
  db.close();
});

test("insertRun + loadManifest round-trips correctly", () => {
  const { db, tmpDir } = createTestDb();
  migrate(db);
  const store = new SqliteRunStore(db);

  const folderPath = path.join(tmpDir, "runs", "test-run");
  fs.mkdirSync(folderPath, { recursive: true });

  const manifest = makeManifest({
    tags: ["standup", "engineering"],
    attachments: ["agenda.pdf"],
    recording_segments: ["2026-04-10_14-00-00"],
    selected_prompts: ["summary", "action-items"],
  });

  store.insertRun(manifest, folderPath);
  assert.equal(isEmptyDatabase(db), false);

  const loaded = store.loadManifest(folderPath);
  assert.equal(loaded.run_id, "test-run-1");
  assert.equal(loaded.title, "Test Meeting");
  assert.equal(loaded.status, "draft");
  assert.deepEqual(loaded.tags.sort(), ["engineering", "standup"]);
  assert.deepEqual(loaded.attachments, ["agenda.pdf"]);
  assert.deepEqual(loaded.recording_segments, ["2026-04-10_14-00-00"]);
  assert.deepEqual(loaded.selected_prompts, ["summary", "action-items"]);

  db.close();
});

test("updateStatus persists status change", () => {
  const { db, tmpDir } = createTestDb();
  migrate(db);
  const store = new SqliteRunStore(db);

  const folderPath = path.join(tmpDir, "runs", "test-run");
  fs.mkdirSync(folderPath, { recursive: true });
  store.insertRun(makeManifest(), folderPath);

  const updated = store.updateStatus(folderPath, "recording", {
    started: "2026-04-10T14:30:00.000Z",
  });
  assert.equal(updated.status, "recording");
  assert.equal(updated.started, "2026-04-10T14:30:00.000Z");

  // Verify it persisted
  const loaded = store.loadManifest(folderPath);
  assert.equal(loaded.status, "recording");

  db.close();
});

test("updatePromptOutput with running/complete/failed transitions", () => {
  const { db, tmpDir } = createTestDb();
  migrate(db);
  const store = new SqliteRunStore(db);

  const folderPath = path.join(tmpDir, "runs", "test-run");
  fs.mkdirSync(folderPath, { recursive: true });
  store.insertRun(makeManifest(), folderPath);

  // Running
  store.updatePromptOutput(folderPath, "summary", {
    status: "running",
    filename: "summary.md",
    label: "Summary",
  });

  let loaded = store.loadManifest(folderPath);
  assert.equal(loaded.prompt_outputs["summary"].status, "running");

  // Complete
  store.updatePromptOutput(folderPath, "summary", {
    status: "complete",
    filename: "summary.md",
    label: "Summary",
    latency_ms: 1500,
    tokens_used: 200,
    completed_at: "2026-04-10T15:00:00.000Z",
  });

  loaded = store.loadManifest(folderPath);
  assert.equal(loaded.prompt_outputs["summary"].status, "complete");
  assert.equal(loaded.prompt_outputs["summary"].latency_ms, 1500);

  // Failed
  store.updatePromptOutput(folderPath, "action-items", {
    status: "failed",
    filename: "action-items.md",
    label: "Action Items",
    error: "API timeout",
  });

  loaded = store.loadManifest(folderPath);
  assert.equal(loaded.prompt_outputs["action-items"].status, "failed");
  assert.equal(loaded.prompt_outputs["action-items"].error, "API timeout");

  db.close();
});

test("listRuns returns sorted results", () => {
  const { db, tmpDir } = createTestDb();
  migrate(db);
  const store = new SqliteRunStore(db);

  const folder1 = path.join(tmpDir, "runs", "run1");
  const folder2 = path.join(tmpDir, "runs", "run2");
  fs.mkdirSync(folder1, { recursive: true });
  fs.mkdirSync(folder2, { recursive: true });

  store.insertRun(
    makeManifest({ run_id: "run-1", title: "First", started: "2026-04-09T10:00:00Z" }),
    folder1
  );
  store.insertRun(
    makeManifest({ run_id: "run-2", title: "Second", started: "2026-04-10T10:00:00Z" }),
    folder2
  );

  const list = store.listRuns();
  assert.equal(list.length, 2);
  assert.equal(list[0].manifest.title, "Second"); // newer first
  assert.equal(list[1].manifest.title, "First");

  db.close();
});

test("deleteRun cascades to prompt_outputs, tags, attachments", () => {
  const { db, tmpDir } = createTestDb();
  migrate(db);
  const store = new SqliteRunStore(db);

  const folderPath = path.join(tmpDir, "runs", "del-run");
  fs.mkdirSync(folderPath, { recursive: true });

  store.insertRun(
    makeManifest({ tags: ["a"], attachments: ["file.pdf"] }),
    folderPath
  );
  store.updatePromptOutput(folderPath, "summary", {
    status: "complete",
    filename: "summary.md",
  });

  store.deleteRun(folderPath);

  const rows = db.prepare("SELECT * FROM runs").all();
  assert.equal(rows.length, 0);
  assert.equal(db.prepare("SELECT COUNT(*) as n FROM prompt_outputs").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) as n FROM tags").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) as n FROM attachments").get().n, 0);

  db.close();
});

test("deleteRuns batch deletes multiple runs", () => {
  const { db, tmpDir } = createTestDb();
  migrate(db);
  const store = new SqliteRunStore(db);

  const folder1 = path.join(tmpDir, "runs", "batch1");
  const folder2 = path.join(tmpDir, "runs", "batch2");
  const folder3 = path.join(tmpDir, "runs", "batch3");
  fs.mkdirSync(folder1, { recursive: true });
  fs.mkdirSync(folder2, { recursive: true });
  fs.mkdirSync(folder3, { recursive: true });

  store.insertRun(makeManifest({ run_id: "b1" }), folder1);
  store.insertRun(makeManifest({ run_id: "b2" }), folder2);
  store.insertRun(makeManifest({ run_id: "b3" }), folder3);

  store.deleteRuns([folder1, folder3]);

  const remaining = store.listRuns();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].manifest.run_id, "b2");

  db.close();
});

test("FTS5 search matches title and description", () => {
  const { db, tmpDir } = createTestDb();
  migrate(db);
  const store = new SqliteRunStore(db);

  const folder1 = path.join(tmpDir, "runs", "search1");
  const folder2 = path.join(tmpDir, "runs", "search2");
  fs.mkdirSync(folder1, { recursive: true });
  fs.mkdirSync(folder2, { recursive: true });

  store.insertRun(
    makeManifest({ run_id: "s1", title: "Sprint Planning", description: "Weekly sprint ceremony" }),
    folder1
  );
  store.insertRun(
    makeManifest({ run_id: "s2", title: "Customer Call", description: "Follow-up discussion" }),
    folder2
  );

  const results = store.searchRuns("sprint");
  assert.equal(results.length, 1);
  assert.equal(results[0].manifest.run_id, "s1");

  const results2 = store.searchRuns("discussion");
  assert.equal(results2.length, 1);
  assert.equal(results2[0].manifest.run_id, "s2");

  db.close();
});

test("participants table schema exists with correct columns", () => {
  const { db } = createTestDb();
  migrate(db);

  // Insert a participant directly
  db.prepare("INSERT INTO participants (first_name, last_name, email) VALUES (?, ?, ?)")
    .run("Alice", "Smith", "alice@example.com");

  const row = db.prepare("SELECT * FROM participants WHERE email = ?")
    .get("alice@example.com");

  assert.equal(row.first_name, "Alice");
  assert.equal(row.last_name, "Smith");
  assert.ok(row.participant_id > 0);

  // Link to a run
  db.prepare("INSERT INTO runs (run_id, folder_path, title, date, started, status) VALUES (?, ?, ?, ?, ?, ?)")
    .run("r1", "/tmp/r1", "Test", "2026-04-10", "2026-04-10T14:00:00Z", "draft");
  db.prepare("INSERT INTO run_participants (run_id, participant_id) VALUES (?, ?)")
    .run("r1", row.participant_id);

  const linked = db.prepare("SELECT p.* FROM participants p INNER JOIN run_participants rp ON p.participant_id = rp.participant_id WHERE rp.run_id = ?")
    .all("r1");
  assert.equal(linked.length, 1);
  assert.equal(linked[0].email, "alice@example.com");

  db.close();
});
