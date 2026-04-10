import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertImportMediaPath,
  isSupportedMediaFileName,
} from "../dist/main/media-import.js";

test("isSupportedMediaFileName accepts common meeting recording formats", () => {
  assert.equal(isSupportedMediaFileName("call.mp4"), true);
  assert.equal(isSupportedMediaFileName("call.mov"), true);
  assert.equal(isSupportedMediaFileName("call.m4a"), true);
  assert.equal(isSupportedMediaFileName("call.txt"), false);
});

test("assertImportMediaPath rejects non-files and unsupported extensions", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meeting-notes-media-import-"));
  const goodPath = path.join(tmpDir, "zoom.mp4");
  const badPath = path.join(tmpDir, "notes.txt");
  const dirPath = path.join(tmpDir, "folder");

  fs.writeFileSync(goodPath, "video");
  fs.writeFileSync(badPath, "text");
  fs.mkdirSync(dirPath);

  assert.equal(assertImportMediaPath(goodPath), path.resolve(goodPath));
  assert.throws(() => assertImportMediaPath(badPath), /Unsupported media type/);
  assert.throws(() => assertImportMediaPath(dirPath), /Only files can be imported/);
  assert.throws(() => assertImportMediaPath(path.join(tmpDir, "missing.mp4")), /could not be found/);
});
