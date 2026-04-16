import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectRunAudioFiles } from "../dist/main/runs-service.js";

function makeTempRun() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mn-seg-app-"));
  const audio = path.join(root, "audio");
  fs.mkdirSync(audio, { recursive: true });
  return { root, audio };
}

test("collectRunAudioFiles: prefers segments over any flat files also present", () => {
  const { root, audio } = makeTempRun();
  // Legacy flat mic + a newer segment dir. With the pre-fix early-return the
  // segment was silently dropped; after the fix, segments win.
  fs.writeFileSync(path.join(audio, "mic.wav"), "legacy-mic");
  fs.writeFileSync(path.join(audio, "system.wav"), "legacy-system");

  const seg1 = path.join(audio, "2026-04-16_14-00-05-100");
  fs.mkdirSync(seg1, { recursive: true });
  fs.writeFileSync(path.join(seg1, "mic.wav"), "seg1-mic");
  fs.writeFileSync(path.join(seg1, "system.wav"), "seg1-system");

  const seg2 = path.join(audio, "2026-04-16_14-10-12-432");
  fs.mkdirSync(seg2, { recursive: true });
  fs.writeFileSync(path.join(seg2, "mic.wav"), "seg2-mic");

  const files = collectRunAudioFiles(root, "both");
  const paths = files.map((f) => f.path);
  // Expect segments in chronological order, no legacy flat files.
  assert.deepEqual(paths, [
    path.join(seg1, "mic.wav"),
    path.join(seg1, "system.wav"),
    path.join(seg2, "mic.wav"),
  ]);
  assert.deepEqual(
    files.map((f) => f.speaker),
    ["me", "others", "me"]
  );
});

test("collectRunAudioFiles: falls back to flat layout when no segments exist", () => {
  const { root, audio } = makeTempRun();
  fs.writeFileSync(path.join(audio, "mic.wav"), "legacy-mic");
  fs.writeFileSync(path.join(audio, "system.wav"), "legacy-system");

  const files = collectRunAudioFiles(root, "both");
  assert.deepEqual(
    files.map((f) => f.path),
    [path.join(audio, "mic.wav"), path.join(audio, "system.wav")]
  );
});

test("collectRunAudioFiles: orders segments chronologically by name", () => {
  const { root, audio } = makeTempRun();
  // Intentionally create in non-chronological order.
  for (const name of [
    "2026-04-16_15-00-00-000",
    "2026-04-16_14-00-05-100",
    "2026-04-16_14-30-00-500",
  ]) {
    const dir = path.join(audio, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "mic.wav"), name);
  }
  const files = collectRunAudioFiles(root, "both");
  const names = files.map((f) => path.basename(path.dirname(f.path)));
  assert.deepEqual(names, [
    "2026-04-16_14-00-05-100",
    "2026-04-16_14-30-00-500",
    "2026-04-16_15-00-00-000",
  ]);
});

test("collectRunAudioFiles: prefers mic.clean.wav over raw mic.wav within a segment", () => {
  const { root, audio } = makeTempRun();
  const seg = path.join(audio, "2026-04-16_14-00-05-100");
  fs.mkdirSync(seg, { recursive: true });
  fs.writeFileSync(path.join(seg, "mic.wav"), "raw");
  fs.writeFileSync(path.join(seg, "mic.clean.wav"), "cleaned");

  const files = collectRunAudioFiles(root, "both");
  assert.equal(files.length, 1);
  assert.equal(files[0].path, path.join(seg, "mic.clean.wav"));
});
