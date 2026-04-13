import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertPathInsideRoot,
  isAllowedRunDocumentName,
  isAllowedRunMediaName,
  listRunFiles,
  resolveRunDocumentPath,
  resolveRunFolderPath,
  resolveRunMediaPath,
  RUN_AUDIO_DIR,
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

test("run media names stay scoped to source recordings (flat and segmented)", () => {
  // Flat layout
  assert.equal(isAllowedRunMediaName("audio/mic.wav"), true);
  assert.equal(isAllowedRunMediaName("audio/zoom.mp4"), true);
  assert.equal(isAllowedRunMediaName("audio/normalized-mic.wav"), false);
  // Segmented layout (audio/<segment>/<file>)
  assert.equal(isAllowedRunMediaName("audio/2026-04-13_10-31-13/mic.wav"), true);
  assert.equal(isAllowedRunMediaName("audio/2026-04-13_10-31-13/system.wav"), true);
  assert.equal(isAllowedRunMediaName("audio/seg-001/recording.mp4"), true);
  assert.equal(isAllowedRunMediaName("audio/2026-04-13_10-31-13/normalized-mic.wav"), false);
  // Traversal and nesting beyond segment level
  assert.equal(isAllowedRunMediaName("audio/../etc/passwd"), false);
  assert.equal(isAllowedRunMediaName("../audio/mic.wav"), false);
  assert.equal(isAllowedRunMediaName("audio/seg/deep/clip.wav"), false);
});

test("resolveRunMediaPath keeps media access scoped to a run folder", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meeting-notes-run-media-"));
  const dataPath = path.join(tmpDir, "Meetings");
  const runFolder = path.join(dataPath, "Runs", "2026", "04", "08", "Media Run");
  const audioDir = path.join(runFolder, RUN_AUDIO_DIR);

  fs.mkdirSync(audioDir, { recursive: true });
  fs.writeFileSync(path.join(runFolder, RUN_INDEX_FILE), "---\nrun_id: 1\ntitle: Test\n---\n");
  fs.writeFileSync(path.join(audioDir, "mic.wav"), "audio");

  const config = makeConfig(dataPath);
  assert.equal(
    resolveRunMediaPath(runFolder, "audio/mic.wav", config),
    path.join(audioDir, "mic.wav")
  );
  assert.throws(
    () => resolveRunMediaPath(runFolder, "audio/normalized-mic.wav", config),
    /invalid/
  );
});

test("resolveRunMediaPath resolves segmented recording paths", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meeting-notes-run-seg-"));
  const dataPath = path.join(tmpDir, "Meetings");
  const runFolder = path.join(dataPath, "Runs", "2026", "04", "08", "Segment Run");
  const segDir = path.join(runFolder, RUN_AUDIO_DIR, "2026-04-13_10-31-13");

  fs.mkdirSync(segDir, { recursive: true });
  fs.writeFileSync(path.join(runFolder, RUN_INDEX_FILE), "---\nrun_id: 1\ntitle: Test\n---\n");
  fs.writeFileSync(path.join(segDir, "mic.wav"), "audio");

  const config = makeConfig(dataPath);
  assert.equal(
    resolveRunMediaPath(runFolder, "audio/2026-04-13_10-31-13/mic.wav", config),
    path.join(segDir, "mic.wav")
  );
  assert.throws(
    () => resolveRunMediaPath(runFolder, "audio/2026-04-13_10-31-13/normalized-mic.wav", config),
    /invalid/
  );
});

test("listRunFiles includes source media but hides normalized internals", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meeting-notes-run-files-"));
  const dataPath = path.join(tmpDir, "Meetings");
  const runFolder = path.join(dataPath, "Runs", "2026", "04", "08", "Imported Run");
  const audioDir = path.join(runFolder, RUN_AUDIO_DIR);

  fs.mkdirSync(audioDir, { recursive: true });
  fs.writeFileSync(path.join(runFolder, RUN_INDEX_FILE), "---\nrun_id: 1\ntitle: Test\n---\n");
  fs.writeFileSync(path.join(runFolder, RUN_NOTES_FILE), "# Notes\n");
  fs.writeFileSync(path.join(runFolder, "run.log"), "hello\n");
  fs.writeFileSync(path.join(audioDir, "zoom-recording.mp4"), "video");
  fs.writeFileSync(path.join(audioDir, "normalized-zoom-recording.wav"), "normalized");

  const config = makeConfig(dataPath);
  const files = listRunFiles(runFolder, config);

  assert.deepEqual(
    files.map((file) => [file.name, file.kind]),
    [
      ["index.md", "document"],
      ["notes.md", "document"],
      ["run.log", "log"],
      ["audio/zoom-recording.mp4", "media"],
    ]
  );
});
