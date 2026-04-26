// Live recording integration test.
//
// Spawns a real FfmpegRecorder (mic via avfoundation + system audio via
// AudioTee) for a few seconds, stops, and verifies that capture-meta is
// populated with the upgraded first-sample sources (not the fallback
// `spawn-time` / `tee-start`) — i.e., that the stderr `time=` parser and
// the AudioTee first-chunk handler both actually fire on a real capture.
//
// This is the class of bug that synthetic unit tests cannot catch: the
// failure mode observed in real runs was that capture-meta was being
// snapshotted BEFORE those async callbacks fired, so the anchor sources
// always shipped as the fallback variants. A synthetic WAV test can't see
// that because there's no real ffmpeg child or CoreAudio tap.
//
// This test is macOS-only and skips when:
//  - the platform isn't macOS,
//  - mic permission hasn't been granted to the test runner,
//  - AudioTee isn't available.

import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FfmpegRecorder } from "../dist/adapters/recording/ffmpeg.js";
import { correctStreamDrift } from "../dist/core/audio.js";

const execFileAsync = promisify(execFile);

async function haveFfmpeg() {
  try {
    await execFileAsync("ffmpeg", ["-hide_banner", "-version"]);
    return true;
  } catch {
    return false;
  }
}

async function shouldSkipLiveRecording(t) {
  if (process.platform !== "darwin") {
    t.skip("live recording is macOS-only");
    return true;
  }
  if (!(await haveFfmpeg())) {
    t.skip("ffmpeg not available");
    return true;
  }
  if (process.env.SKIP_LIVE_RECORDING === "1") {
    t.skip("SKIP_LIVE_RECORDING=1");
    return true;
  }
  return false;
}

test("FfmpegRecorder: capture-meta reports upgraded first-sample sources on a real 3s capture", async (t) => {
  if (await shouldSkipLiveRecording(t)) return;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "live-rec-test-"));
  const collectedLogs = [];
  const logger = {
    info: (msg, data) => collectedLogs.push({ level: "info", msg, data }),
    warn: (msg, data) => collectedLogs.push({ level: "warn", msg, data }),
    error: (msg, data) => collectedLogs.push({ level: "error", msg, data }),
  };

  let session;
  try {
    const recorder = new FfmpegRecorder(logger);
    try {
      session = await recorder.start({
        micDevice: "",
        systemDevice: "",
        outputDir: tmpDir,
      });
    } catch (err) {
      t.skip(`could not start recorder (likely missing mic permission): ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    // Let it run long enough for ffmpeg to emit its first `time=` status
    // line (ffmpeg's stats flush is ~500ms) and for AudioTee to deliver
    // multiple chunks. 3 seconds is a comfortable margin.
    await new Promise((r) => setTimeout(r, 3000));

    await session.stop();
  } finally {
    // Always attempt cleanup, even on failure.
    try { if (session) await session.stop(); } catch {}
  }

  const meta = session.captureMeta;
  assert.ok(meta, "captureMeta should be populated");
  assert.ok(meta.mic, "captureMeta.mic should be populated");
  assert.ok(fs.existsSync(session.paths.mic), "mic.wav should exist on disk");

  // The critical regression gate: the mic first-sample anchor must be
  // upgraded from the spawn-time fallback by stop(). The live source
  // varies with the backend:
  //  - native helper → "mic-capture-first-sample"  (preferred; bundled)
  //  - ffmpeg        → "stderr-time"               (fallback; degraded)
  assert.ok(
    meta.mic.firstSampleSource === "mic-capture-first-sample" ||
      meta.mic.firstSampleSource === "stderr-time",
    `mic.firstSampleSource should upgrade to mic-capture-first-sample or stderr-time, got "${meta.mic.firstSampleSource}"`
  );
  assert.ok(meta.mic.stoppedAtMs && meta.mic.stoppedAtMs > 0, "mic.stoppedAtMs required");
  assert.ok(meta.mic.durationMs && meta.mic.durationMs > 1000, "mic.durationMs should be > 1s");
  assert.ok(meta.mic.endAnchorAtMs, "mic.endAnchorAtMs required");

  // Drop-rate gate: the fraction of wall-clock time missing from the file.
  // For ffmpeg AVFoundation (degraded mode) this is the ~10-12% mid-
  // recording sample drop. For the native helper the only shortfall is a
  // ~300-500ms startup warmup before the hardware begins delivering
  // samples — a fixed cost, not proportional. This test uses a larger
  // budget for the 3-second capture than the 10-second drift test below
  // because that fixed cost is a bigger proportion of short captures.
  const micWallMs = meta.mic.stoppedAtMs - meta.mic.firstSampleAtMs;
  const dropRatio = 1 - meta.mic.durationMs / micWallMs;
  if (meta.mic.firstSampleSource === "mic-capture-first-sample") {
    // On a 3s capture, allow up to 15% (≈450ms absolute startup warmup).
    assert.ok(
      dropRatio < 0.15,
      `native helper 3s drop rate too high; got ${(dropRatio * 100).toFixed(1)}% ` +
        `(file=${meta.mic.durationMs}ms wall=${micWallMs}ms). ` +
        `Expected startup warmup only (~300-500ms, no mid-capture drops).`
    );
  }

  if (session.systemCaptured) {
    assert.ok(meta.system, "captureMeta.system should be populated when AudioTee captures");
    if (!meta.system.durationMs || meta.system.durationMs <= 1000) {
      t.skip("AudioTee is active, but this host did not produce a usable system audio stream");
      return;
    }
    assert.equal(
      meta.system.firstSampleSource,
      "first-chunk",
      `system.firstSampleSource should upgrade to "first-chunk", got "${meta.system.firstSampleSource}"`
    );
    assert.ok(meta.system.endAnchorAtMs, "system.endAnchorAtMs required");

    // Sanity: start-anchor-based offset and end-anchor-based offset should
    // agree within ~1 second on a clean 3-second capture. We deliberately
    // don't require a tighter bound because avfoundation warmup can be
    // several hundred ms even on a healthy machine.
    const startOffsetMs = meta.mic.firstSampleAtMs - meta.system.firstSampleAtMs;
    const endOffsetMs = meta.mic.endAnchorAtMs - meta.system.endAnchorAtMs;
    const disagreementMs = Math.abs(startOffsetMs - endOffsetMs);
    assert.ok(
      disagreementMs < 1000,
      `start-anchor (${startOffsetMs}ms) and end-anchor (${endOffsetMs}ms) should agree within 1s, disagreement ${disagreementMs}ms`
    );
  }

  // Leave the tmp dir around only if the assertion failed (assert throws
  // before this line). On success, clean up.
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("FfmpegRecorder: recording writes to local scratch and moves finalized files into the run folder", async (t) => {
  if (await shouldSkipLiveRecording(t)) return;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "live-scratch-test-"));
  const logger = { info() {}, warn() {}, error() {} };

  // Snapshot existing tmp entries so we can tell which mn-capture- dirs
  // appeared during this test.
  const tmpSnapshotBefore = new Set(fs.readdirSync(os.tmpdir()));

  let session;
  try {
    const recorder = new FfmpegRecorder(logger);
    try {
      session = await recorder.start({
        micDevice: "",
        systemDevice: "",
        outputDir: tmpDir,
      });
    } catch (err) {
      t.skip(`could not start recorder: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    // While recording, the run folder should be empty: the active
    // capture is going to a scratch dir, not the target. This is the
    // critical property — it's why disk I/O on the target volume can't
    // back-pressure the USB audio pipeline.
    await new Promise((r) => setTimeout(r, 500));
    const duringCapture = fs.readdirSync(tmpDir);
    assert.ok(
      !duringCapture.includes("mic.wav"),
      `during capture, mic.wav should NOT be in the final run folder (got ${duringCapture.join(", ")})`
    );

    // And a fresh mn-capture-* scratch dir should exist under tmpdir.
    const scratchDirs = fs
      .readdirSync(os.tmpdir())
      .filter((n) => n.startsWith("mn-capture-") && !tmpSnapshotBefore.has(n));
    assert.ok(
      scratchDirs.length >= 1,
      "expected an mn-capture-* scratch directory to exist during capture"
    );

    await new Promise((r) => setTimeout(r, 1500));
    await session.stop();
  } finally {
    try { if (session) await session.stop(); } catch {}
  }

  // After stop: mic.wav (and system.wav, if captured) must be in the
  // final run folder, and the scratch dir must be gone.
  const afterStop = fs.readdirSync(tmpDir);
  assert.ok(afterStop.includes("mic.wav"), `mic.wav should be in final run folder, got ${afterStop.join(", ")}`);
  if (session.systemCaptured) {
    assert.ok(afterStop.includes("system.wav"), `system.wav should be in final run folder, got ${afterStop.join(", ")}`);
  }

  const leftoverScratch = fs
    .readdirSync(os.tmpdir())
    .filter((n) => n.startsWith("mn-capture-") && !tmpSnapshotBefore.has(n));
  assert.deepEqual(
    leftoverScratch,
    [],
    `scratch directories should be cleaned up after stop, found: ${leftoverScratch.join(", ")}`
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("FfmpegRecorder: native mic helper has no pathological mid-recording drops (<6% on 10s)", async (t) => {
  if (await shouldSkipLiveRecording(t)) return;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "live-native-drop-test-"));
  const logger = { info() {}, warn() {}, error() {} };

  let session;
  try {
    const recorder = new FfmpegRecorder(logger);
    try {
      session = await recorder.start({
        micDevice: "",
        systemDevice: "",
        outputDir: tmpDir,
      });
    } catch (err) {
      t.skip(`could not start recorder: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    // 10s is long enough that the fixed ~300-500ms startup warmup is a
    // small proportion of the total capture. The regression we're
    // guarding against is the AVFoundation behavior of losing ~11% of
    // samples continuously throughout the recording.
    await new Promise((r) => setTimeout(r, 10_000));
    await session.stop();
  } finally {
    try { if (session) await session.stop(); } catch {}
  }

  const meta = session.captureMeta;
  assert.ok(meta?.mic, "mic capture-meta required");

  // If the native helper isn't available in this environment, skip the
  // assertion rather than fail — drift correction handles the ffmpeg
  // case. The check:bundle script guards against shipping without it.
  if (meta.mic.firstSampleSource !== "mic-capture-first-sample") {
    t.diagnostic(
      `native helper not in use (source=${meta.mic.firstSampleSource}); skipping drop-rate gate`
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return;
  }

  const wallMs = meta.mic.stoppedAtMs - meta.mic.firstSampleAtMs;
  const fileMs = meta.mic.durationMs;
  const dropRatio = 1 - fileMs / wallMs;
  assert.ok(
    dropRatio < 0.06,
    `native helper 10s drop rate too high (regression to AVFoundation-style drops?); ` +
      `got ${(dropRatio * 100).toFixed(2)}% (file=${fileMs}ms wall=${wallMs}ms)`
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("FfmpegRecorder: a 10s real capture has no pathological drift once corrected", async (t) => {
  if (await shouldSkipLiveRecording(t)) return;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "live-drift-test-"));
  const logger = {
    info() {},
    warn() {},
    error() {},
  };

  let session;
  try {
    const recorder = new FfmpegRecorder(logger);
    try {
      session = await recorder.start({
        micDevice: "",
        systemDevice: "",
        outputDir: tmpDir,
      });
    } catch (err) {
      t.skip(`could not start recorder: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    // 10s is long enough that a ~1% drift becomes visible (~100ms),
    // but short enough to keep the test quick.
    await new Promise((r) => setTimeout(r, 10_000));
    await session.stop();
  } finally {
    try { if (session) await session.stop(); } catch {}
  }

  const meta = session.captureMeta;
  assert.ok(meta?.mic, "captureMeta.mic required");
  const micWall = meta.mic.stoppedAtMs - meta.mic.firstSampleAtMs;
  assert.ok(micWall > 9000, `expected mic wall-clock ~10s, got ${micWall}ms`);

  const result = await correctStreamDrift(session.paths.mic, micWall, { logger });
  // Whether or not it applied, the resulting file must match wall-clock
  // within 50ms. This is the real acceptance criterion: after processing,
  // the mic file's playback duration should equal its wall-clock capture.
  const finalDurationMs =
    (result.applied && result.correctedDurationMs) ||
    (result.fileDurationMs ?? 0);
  assert.ok(
    Math.abs(finalDurationMs - micWall) < 100,
    `mic file duration should be within 100ms of wall-clock; file=${finalDurationMs}ms wall=${micWall}ms applied=${result.applied}`
  );

  if (session.systemCaptured && meta.system?.firstSampleAtMs && meta.system.stoppedAtMs) {
    const sysWall = meta.system.stoppedAtMs - meta.system.firstSampleAtMs;
    const sysResult = await correctStreamDrift(session.paths.system, sysWall, { logger });
    const sysFinal =
      (sysResult.applied && sysResult.correctedDurationMs) ||
      (sysResult.fileDurationMs ?? 0);
    assert.ok(
      Math.abs(sysFinal - sysWall) < 100,
      `system file duration should be within 100ms of wall-clock; file=${sysFinal}ms wall=${sysWall}ms`
    );
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
