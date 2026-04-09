import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertPathInsideRoot,
  isAllowedRunDocumentName,
  resolveRunDocumentPath,
  resolveRunFolderPath,
  RUN_INDEX_FILE,
  RUN_NOTES_FILE,
} from "../dist/main/run-access.js";

function makeConfig(dataPath) {
  return { data_path: dataPath };
}

test("assertPathInsideRoot rejects traversal outside the allowed root", () => {
  const root = "/tmp/meeting-notes";
  assert.throws(
    () => assertPathInsideRoot(root, "/tmp/other-place/file.md", "Run document"),
    /outside the allowed directory/
  );
});

test("resolveRunFolderPath and resolveRunDocumentPath keep access scoped to a run folder", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meeting-notes-run-access-"));
  const dataPath = path.join(tmpDir, "Meetings");
  const runFolder = path.join(dataPath, "Runs", "2026", "04", "08", "My Run");

  fs.mkdirSync(runFolder, { recursive: true });
  fs.writeFileSync(path.join(runFolder, RUN_INDEX_FILE), "---\nrun_id: 1\ntitle: Test\n---\n");
  fs.writeFileSync(path.join(runFolder, RUN_NOTES_FILE), "# Notes\n");

  const config = makeConfig(dataPath);

  assert.equal(resolveRunFolderPath(runFolder, config), runFolder);
  assert.equal(
    resolveRunDocumentPath(runFolder, RUN_NOTES_FILE, config),
    path.join(runFolder, RUN_NOTES_FILE)
  );
  assert.throws(
    () => resolveRunDocumentPath(runFolder, "../secrets.txt", config),
    /invalid/
  );
});

test("isAllowedRunDocumentName only accepts markdown documents and run.log", () => {
  assert.equal(isAllowedRunDocumentName("notes.md"), true);
  assert.equal(isAllowedRunDocumentName("run.log"), true);
  assert.equal(isAllowedRunDocumentName("nested/notes.md"), false);
  assert.equal(isAllowedRunDocumentName("notes.txt"), false);
});
