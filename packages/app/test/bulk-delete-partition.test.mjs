import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  partitionRunFoldersForBulkDelete,
  RUN_INDEX_FILE,
} from "../dist/main/run-access.js";

function makeConfig(dataPath) {
  return { data_path: dataPath };
}

function makeRealRunFolder(dataPath, label) {
  const runFolder = path.join(dataPath, "Runs", "2026", "04", "08", label);
  fs.mkdirSync(runFolder, { recursive: true });
  fs.writeFileSync(
    path.join(runFolder, RUN_INDEX_FILE),
    "---\nrun_id: 1\ntitle: Test\n---\n"
  );
  return runFolder;
}

// This test guards against a previously-shipped P0: the bulk-delete handler
// pushed the *raw* (unvalidated) input into the same array that fs.rmSync
// then ran over, allowing a renderer call to remove arbitrary directories.
// The partition helper must never let an outside-runs-root path or a
// non-existent path land in `validatedFolders`.
test("partitionRunFoldersForBulkDelete keeps unsafe paths out of validatedFolders", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gistlist-bulk-delete-"));
  const dataPath = path.join(tmpDir, "Meetings");
  const sentinelOutside = path.join(tmpDir, "outside-sentinel");
  const sentinelMarker = path.join(sentinelOutside, "marker");

  fs.mkdirSync(dataPath, { recursive: true });
  fs.mkdirSync(sentinelOutside, { recursive: true });
  fs.writeFileSync(sentinelMarker, "do-not-delete");

  const realRun = makeRealRunFolder(dataPath, "Real Run");
  const config = makeConfig(dataPath);

  const result = partitionRunFoldersForBulkDelete(
    [
      realRun,
      sentinelOutside,
      "../../../etc",
      path.join(dataPath, "Runs", "2026", "04", "08", "Never Existed"),
    ],
    config
  );

  // Only the real, in-root, existing folder is safe to rmSync.
  assert.deepEqual(result.validatedFolders, [realRun]);

  // Everything else lands in dbOnly — they may still need DB-row cleanup but
  // must not be touched on disk.
  assert.equal(result.dbOnlyFolders.length, 3);
  assert.ok(result.dbOnlyFolders.includes(sentinelOutside));
  assert.ok(result.dbOnlyFolders.includes("../../../etc"));

  // Sentinel survives — the partition helper does not touch the filesystem.
  assert.ok(fs.existsSync(sentinelMarker), "sentinel marker must still exist");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("partitionRunFoldersForBulkDelete tolerates an empty input list", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gistlist-bulk-delete-empty-"));
  const dataPath = path.join(tmpDir, "Meetings");
  fs.mkdirSync(dataPath, { recursive: true });

  const result = partitionRunFoldersForBulkDelete([], makeConfig(dataPath));
  assert.deepEqual(result.validatedFolders, []);
  assert.deepEqual(result.dbOnlyFolders, []);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
