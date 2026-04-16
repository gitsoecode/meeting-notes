import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  formatAudioSegmentName,
  migrateFlatLayoutToSegment,
} from "../dist/core/run.js";
import { mergeTranscripts } from "../dist/core/process-run.js";

// ---- formatAudioSegmentName ----

test("formatAudioSegmentName: includes millisecond precision", () => {
  const name = formatAudioSegmentName(new Date("2026-04-16T14:23:05.812Z"));
  // Format is local-time YYYY-MM-DD_HH-MM-SS-mmm.
  assert.match(name, /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}$/);
  assert.ok(name.endsWith("-812"), `expected ms suffix "-812" in ${name}`);
});

test("formatAudioSegmentName: distinct names when called in the same second", () => {
  const a = formatAudioSegmentName(new Date("2026-04-16T14:23:05.100Z"));
  const b = formatAudioSegmentName(new Date("2026-04-16T14:23:05.900Z"));
  assert.notEqual(a, b, "ms-level precision should produce distinct names within one second");
});

// ---- migrateFlatLayoutToSegment ----

function makeTempRun() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mn-run-seg-"));
  const audio = path.join(root, "audio");
  fs.mkdirSync(audio, { recursive: true });
  return { root, audio };
}

test("migrateFlatLayoutToSegment: moves flat mic.wav/system.wav into a back-dated segment", () => {
  const { root, audio } = makeTempRun();
  fs.writeFileSync(path.join(audio, "mic.wav"), "mic-data");
  fs.writeFileSync(path.join(audio, "system.wav"), "system-data");
  fs.writeFileSync(path.join(audio, "capture-meta.json"), '{"legacy":true}');

  const seg = migrateFlatLayoutToSegment(root, "2026-04-16T14:00:00.000Z");
  assert.ok(seg, "should return the migrated segment name");

  assert.equal(fs.existsSync(path.join(audio, "mic.wav")), false, "flat mic.wav should be gone");
  assert.equal(fs.existsSync(path.join(audio, "system.wav")), false, "flat system.wav should be gone");

  const segDir = path.join(audio, seg);
  assert.equal(fs.readFileSync(path.join(segDir, "mic.wav"), "utf8"), "mic-data");
  assert.equal(fs.readFileSync(path.join(segDir, "system.wav"), "utf8"), "system-data");
  assert.equal(fs.readFileSync(path.join(segDir, "capture-meta.json"), "utf8"), '{"legacy":true}');
});

test("migrateFlatLayoutToSegment: returns null when no flat files exist", () => {
  const { root } = makeTempRun();
  assert.equal(migrateFlatLayoutToSegment(root, "2026-04-16T14:00:00.000Z"), null);
});

test("migrateFlatLayoutToSegment: avoids clobbering an existing segment dir", () => {
  const { root, audio } = makeTempRun();
  fs.writeFileSync(path.join(audio, "mic.wav"), "mic-data");
  // Pre-create a segment dir at the name the back-date would resolve to.
  const colliding = formatAudioSegmentName(new Date("2026-04-16T14:00:00.000Z"));
  fs.mkdirSync(path.join(audio, colliding), { recursive: true });
  fs.writeFileSync(path.join(audio, colliding, "existing.wav"), "pre-existing");

  const seg = migrateFlatLayoutToSegment(root, "2026-04-16T14:00:00.000Z");
  assert.ok(seg, "should still migrate");
  assert.notEqual(seg, colliding, "should not use the colliding name");
  assert.equal(
    fs.readFileSync(path.join(audio, colliding, "existing.wav"), "utf8"),
    "pre-existing",
    "pre-existing segment files must not be overwritten"
  );
});

// ---- mergeTranscripts ----

test("mergeTranscripts: sums durationMs across inputs (was max before segment support)", () => {
  const a = {
    segments: [{ start_ms: 0, end_ms: 1000, text: "a", speaker: "me" }],
    fullText: "a",
    provider: "parakeet",
    durationMs: 5000,
  };
  const b = {
    segments: [{ start_ms: 2000, end_ms: 3000, text: "b", speaker: "others" }],
    fullText: "b",
    provider: "parakeet",
    durationMs: 8000,
  };
  const merged = mergeTranscripts([a, b]);
  assert.equal(merged.durationMs, 13000, "durationMs should be sum of inputs, not max");
  assert.deepEqual(
    merged.segments.map((s) => s.text),
    ["a", "b"],
    "segments sorted by start_ms"
  );
});
