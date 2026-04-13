import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { migrate } from "../dist/main/db/migrate.js";
import { SqliteRunStore } from "../dist/main/db/sqlite-run-store.js";

function createTestDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mn-retention-test-"));
  const dbPath = path.join(tmpDir, "test.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return { db, tmpDir };
}

function makeManifest(overrides = {}) {
  return {
    run_id: "run-1",
    title: "Test Meeting",
    description: null,
    date: "2026-03-01",
    started: "2026-03-01T10:00:00.000Z",
    ended: null,
    status: "complete",
    source_mode: "both",
    tags: [],
    participants: [],
    duration_minutes: 30,
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

function insertRun(store, tmpDir, id, { status, ended }) {
  const folderPath = path.join(tmpDir, "runs", id);
  fs.mkdirSync(folderPath, { recursive: true });
  store.insertRun(
    makeManifest({ run_id: id, ended, status }),
    folderPath
  );
  return folderPath;
}

// --- listExpiredAudioRuns tests ---

test("listExpiredAudioRuns returns completed runs older than cutoff", () => {
  const { db, tmpDir } = createTestDb();
  migrate(db);
  const store = new SqliteRunStore(db);

  // Completed run that ended 10 days ago
  const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
  insertRun(store, tmpDir, "old-run", { status: "complete", ended: tenDaysAgo });

  // Cutoff = 7 days ago
  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const expired = store.listExpiredAudioRuns(cutoff);

  assert.equal(expired.length, 1);
  assert.ok(expired[0].folder_path.includes("old-run"));

  db.close();
});

test("listExpiredAudioRuns excludes runs newer than cutoff", () => {
  const { db, tmpDir } = createTestDb();
  migrate(db);
  const store = new SqliteRunStore(db);

  // Completed run that ended 3 days ago
  const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
  insertRun(store, tmpDir, "recent-run", { status: "complete", ended: threeDaysAgo });

  // Cutoff = 7 days ago
  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const expired = store.listExpiredAudioRuns(cutoff);

  assert.equal(expired.length, 0);

  db.close();
});

test("listExpiredAudioRuns excludes draft, recording, and processing runs", () => {
  const { db, tmpDir } = createTestDb();
  migrate(db);
  const store = new SqliteRunStore(db);

  const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
  insertRun(store, tmpDir, "draft-run", { status: "draft", ended: tenDaysAgo });
  insertRun(store, tmpDir, "recording-run", { status: "recording", ended: tenDaysAgo });
  insertRun(store, tmpDir, "processing-run", { status: "processing", ended: tenDaysAgo });

  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const expired = store.listExpiredAudioRuns(cutoff);

  assert.equal(expired.length, 0);

  db.close();
});

test("listExpiredAudioRuns excludes runs with no ended timestamp", () => {
  const { db, tmpDir } = createTestDb();
  migrate(db);
  const store = new SqliteRunStore(db);

  insertRun(store, tmpDir, "no-ended-run", { status: "complete", ended: null });

  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const expired = store.listExpiredAudioRuns(cutoff);

  assert.equal(expired.length, 0);

  db.close();
});

test("listExpiredAudioRuns includes failed runs past cutoff", () => {
  const { db, tmpDir } = createTestDb();
  migrate(db);
  const store = new SqliteRunStore(db);

  const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
  insertRun(store, tmpDir, "failed-run", { status: "failed", ended: tenDaysAgo });

  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const expired = store.listExpiredAudioRuns(cutoff);

  assert.equal(expired.length, 1);

  db.close();
});

// --- End-to-end simulation: audio directory cleanup ---

test("expired run audio directory is deleted while documents are preserved", () => {
  const { db, tmpDir } = createTestDb();
  migrate(db);
  const store = new SqliteRunStore(db);

  const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
  const folderPath = insertRun(store, tmpDir, "cleanup-run", {
    status: "complete",
    ended: tenDaysAgo,
  });

  // Create audio files and a document in the run folder
  const audioDir = path.join(folderPath, "audio");
  fs.mkdirSync(audioDir, { recursive: true });
  fs.writeFileSync(path.join(audioDir, "mic.wav"), Buffer.alloc(1024));
  fs.writeFileSync(path.join(audioDir, "system.wav"), Buffer.alloc(1024));
  fs.writeFileSync(path.join(folderPath, "transcript.md"), "# Transcript\nHello");
  fs.writeFileSync(path.join(folderPath, "summary.md"), "# Summary\nNotes");

  // Verify files exist before cleanup
  assert.ok(fs.existsSync(path.join(audioDir, "mic.wav")));
  assert.ok(fs.existsSync(path.join(audioDir, "system.wav")));

  // Simulate cleanup: query expired runs + delete audio dirs
  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const expired = store.listExpiredAudioRuns(cutoff);
  assert.equal(expired.length, 1);

  for (const { folder_path } of expired) {
    const ad = path.join(folder_path, "audio");
    if (fs.existsSync(ad)) {
      fs.rmSync(ad, { recursive: true, force: true });
    }
  }

  // Audio directory should be gone
  assert.ok(!fs.existsSync(audioDir), "audio directory should be deleted");
  assert.ok(!fs.existsSync(path.join(audioDir, "mic.wav")));
  assert.ok(!fs.existsSync(path.join(audioDir, "system.wav")));

  // Documents should still exist
  assert.ok(fs.existsSync(path.join(folderPath, "transcript.md")), "transcript should be preserved");
  assert.ok(fs.existsSync(path.join(folderPath, "summary.md")), "summary should be preserved");

  // Run folder itself should still exist
  assert.ok(fs.existsSync(folderPath), "run folder should still exist");

  db.close();
});
