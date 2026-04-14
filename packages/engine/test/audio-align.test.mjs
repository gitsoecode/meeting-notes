import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  estimateMicSystemOffsetMs,
  mergeTimedAudioFiles,
  analyzeAudioLevels,
  chooseConservativeGainDb,
  buildSpeechCleanupPlan,
  cleanMicForSpeech,
  correctStreamDrift,
} from "../dist/core/audio.js";
import { resolveTrackOffsetMetadata } from "../dist/core/process-run.js";

const execFileAsync = promisify(execFile);

// Skip the entire file if ffmpeg is not available. CI images without ffmpeg
// shouldn't fail the whole suite over a capability-dependent test.
async function haveFfmpeg() {
  try {
    await execFileAsync("ffmpeg", ["-hide_banner", "-version"]);
    return true;
  } catch {
    return false;
  }
}

async function makeSyntheticWav(outPath, { durationSec, startDelaySec, seed }) {
  // A deterministic noise burst makes the cross-correlation peak unambiguous
  // (unlike a pure sine, which has periodic peaks). We prepend silence to
  // encode the per-track start offset.
  //
  // Uses ffmpeg filter graphs: aevalsrc generates procedural noise from the
  // sample index, anullsrc pads leading silence, concat glues them together.
  const noiseExpr = `sin(2*PI*random(${seed})*t)`;
  const filter = [
    startDelaySec > 0
      ? `anullsrc=channel_layout=mono:sample_rate=16000:duration=${startDelaySec}[pad];`
      : "",
    `aevalsrc='${noiseExpr}':sample_rate=16000:channel_layout=mono:duration=${durationSec}[noise]`,
    startDelaySec > 0
      ? `;[pad][noise]concat=n=2:v=0:a=1[out]`
      : "",
  ].join("");
  const map = startDelaySec > 0 ? "[out]" : "[noise]";

  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel", "error",
    "-filter_complex", filter,
    "-map", map,
    "-ar", "16000",
    "-ac", "1",
    "-c:a", "pcm_s16le",
    "-y",
    outPath,
  ]);
}

async function assertMixMatchesReference(actualMixPath, referenceMixPath) {
  const { offsetMs, confidence } = await estimateMicSystemOffsetMs(
    actualMixPath,
    referenceMixPath,
    { hintOffsetMs: 0, maxOffsetMs: 1000, windowSec: 5 }
  );
  assert.ok(
    Math.abs(offsetMs) <= 20,
    `expected mixed output to align with reference, got ${offsetMs} ms (confidence ${confidence})`
  );
}

test("estimateMicSystemOffsetMs: recovers a 250 ms offset between noise bursts", async (t) => {
  if (!(await haveFfmpeg())) {
    t.skip("ffmpeg not available");
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "align-test-"));
  const micPath = path.join(tmpDir, "mic.wav");
  const sysPath = path.join(tmpDir, "system.wav");

  try {
    // Mic has no leading silence; system is delayed by 250 ms. Same noise
    // source seed so the two tracks contain the same underlying pattern.
    await makeSyntheticWav(micPath, { durationSec: 5, startDelaySec: 0, seed: 42 });
    await makeSyntheticWav(sysPath, { durationSec: 5, startDelaySec: 0.25, seed: 42 });

    const { offsetMs, confidence } = await estimateMicSystemOffsetMs(
      micPath,
      sysPath,
      { hintOffsetMs: 200, maxOffsetMs: 1000, windowSec: 5 }
    );

    assert.ok(
      Math.abs(offsetMs - 250) <= 20,
      `expected ~250 ms offset, got ${offsetMs} (confidence ${confidence})`
    );
    assert.ok(confidence >= 1.5, `expected confidence >= 1.5, got ${confidence}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("estimateMicSystemOffsetMs: returns zero confidence when both tracks are near-silent", async (t) => {
  if (!(await haveFfmpeg())) {
    t.skip("ffmpeg not available");
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "align-test-"));
  const micPath = path.join(tmpDir, "mic.wav");
  const sysPath = path.join(tmpDir, "system.wav");

  try {
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi",
      "-i", "anullsrc=channel_layout=mono:sample_rate=16000",
      "-t", "3",
      "-c:a", "pcm_s16le",
      "-y",
      micPath,
    ]);
    fs.copyFileSync(micPath, sysPath);

    const { offsetMs, confidence } = await estimateMicSystemOffsetMs(
      micPath,
      sysPath,
      { windowSec: 3 }
    );
    assert.equal(offsetMs, 0);
    assert.equal(confidence, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("mergeTimedAudioFiles: applies offset so delayed system audio matches reference mix", async (t) => {
  if (!(await haveFfmpeg())) {
    t.skip("ffmpeg not available");
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-align-test-"));
  const micPath = path.join(tmpDir, "mic.wav");
  const systemDelayedPath = path.join(tmpDir, "system-delayed.wav");
  const systemRefPath = path.join(tmpDir, "system-ref.wav");
  const alignedMixPath = path.join(tmpDir, "aligned-mix.wav");
  const referenceMixPath = path.join(tmpDir, "reference-mix.wav");

  try {
    await makeSyntheticWav(micPath, { durationSec: 5, startDelaySec: 0, seed: 42 });
    await makeSyntheticWav(systemDelayedPath, { durationSec: 5, startDelaySec: 0.25, seed: 42 });
    await makeSyntheticWav(systemRefPath, { durationSec: 5, startDelaySec: 0, seed: 42 });

    await mergeTimedAudioFiles(
      [
        { path: micPath },
        { path: systemDelayedPath, offsetMs: 250 },
      ],
      alignedMixPath
    );
    await mergeTimedAudioFiles(
      [
        { path: micPath },
        { path: systemRefPath },
      ],
      referenceMixPath
    );

    await assertMixMatchesReference(alignedMixPath, referenceMixPath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("mergeTimedAudioFiles: applies per-input offsets for segmented-style mixes", async (t) => {
  if (!(await haveFfmpeg())) {
    t.skip("ffmpeg not available");
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-segment-test-"));
  const alignedMixPath = path.join(tmpDir, "aligned-mix.wav");
  const referenceMixPath = path.join(tmpDir, "reference-mix.wav");

  try {
    const mic1 = path.join(tmpDir, "mic1.wav");
    const sys1Delayed = path.join(tmpDir, "sys1-delayed.wav");
    const sys1Ref = path.join(tmpDir, "sys1-ref.wav");
    const mic2 = path.join(tmpDir, "mic2.wav");
    const sys2Delayed = path.join(tmpDir, "sys2-delayed.wav");
    const sys2Ref = path.join(tmpDir, "sys2-ref.wav");

    await makeSyntheticWav(mic1, { durationSec: 5, startDelaySec: 0, seed: 11 });
    await makeSyntheticWav(sys1Delayed, { durationSec: 5, startDelaySec: 0.25, seed: 11 });
    await makeSyntheticWav(sys1Ref, { durationSec: 5, startDelaySec: 0, seed: 11 });
    await makeSyntheticWav(mic2, { durationSec: 5, startDelaySec: 0, seed: 29 });
    await makeSyntheticWav(sys2Delayed, { durationSec: 5, startDelaySec: 0.4, seed: 29 });
    await makeSyntheticWav(sys2Ref, { durationSec: 5, startDelaySec: 0, seed: 29 });

    await mergeTimedAudioFiles(
      [
        { path: mic1 },
        { path: sys1Delayed, offsetMs: 250 },
        { path: mic2 },
        { path: sys2Delayed, offsetMs: 400 },
      ],
      alignedMixPath
    );
    await mergeTimedAudioFiles(
      [
        { path: mic1 },
        { path: sys1Ref },
        { path: mic2 },
        { path: sys2Ref },
      ],
      referenceMixPath
    );

    await assertMixMatchesReference(alignedMixPath, referenceMixPath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("resolveTrackOffsetMetadata: prefers sidecar offset, then capture metadata, then none", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "offset-meta-test-"));

  try {
    const runFolder = path.join(tmpDir, "run");
    const audioRoot = path.join(runFolder, "audio");
    const segmentDir = path.join(audioRoot, "segment-a");
    fs.mkdirSync(segmentDir, { recursive: true });

    const micPath = path.join(segmentDir, "mic.wav");
    fs.writeFileSync(micPath, "");
    fs.writeFileSync(
      path.join(audioRoot, "capture-meta.json"),
      JSON.stringify({ micStartedAtMs: 1000, systemStartedAtMs: 1120 })
    );

    // Convention: offsetMs = micFirst − sysFirst (see CaptureHint docs).
    // mic=1000, sys=1120 → mic − sys = −120.
    const captureMetaResult = resolveTrackOffsetMetadata(micPath, runFolder);
    assert.deepEqual(captureMetaResult, { offsetMs: -120, source: "capture-meta" });

    fs.writeFileSync(
      path.join(segmentDir, "aec.json"),
      JSON.stringify({ offsetMs: 250, confidence: 1.7, source: "xcorr" })
    );
    const sidecarResult = resolveTrackOffsetMetadata(micPath, runFolder);
    assert.deepEqual(sidecarResult, { offsetMs: 250, source: "aec-sidecar" });

    fs.rmSync(path.join(segmentDir, "aec.json"));
    fs.rmSync(path.join(audioRoot, "capture-meta.json"));
    const noneResult = resolveTrackOffsetMetadata(micPath, runFolder);
    assert.deepEqual(noneResult, { offsetMs: 0, source: "none" });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("chooseConservativeGainDb: boosts quiet tracks and trims loud ones within bounds", async (t) => {
  if (!(await haveFfmpeg())) {
    t.skip("ffmpeg not available");
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-test-"));
  const quietPath = path.join(tmpDir, "quiet.wav");
  const loudPath = path.join(tmpDir, "loud.wav");

  try {
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi",
      "-i", "sine=frequency=660:sample_rate=16000:duration=2",
      "-af", "volume=-18dB",
      "-c:a", "pcm_s16le",
      "-y",
      quietPath,
    ]);
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi",
      "-i", "sine=frequency=660:sample_rate=16000:duration=2",
      "-af", "volume=8dB",
      "-c:a", "pcm_s16le",
      "-y",
      loudPath,
    ]);

    const quietLevels = await analyzeAudioLevels(quietPath);
    const loudLevels = await analyzeAudioLevels(loudPath);
    const quietGain = chooseConservativeGainDb(quietLevels);
    const loudGain = chooseConservativeGainDb(loudLevels);

    assert.ok(quietGain > 0, `expected quiet track to be boosted, got ${quietGain} dB`);
    assert.ok(loudGain < 0, `expected loud track to be attenuated, got ${loudGain} dB`);
    assert.ok(quietGain <= 6, `expected quiet gain to stay bounded, got ${quietGain} dB`);
    assert.ok(loudGain >= -8, `expected loud attenuation to stay bounded, got ${loudGain} dB`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("chooseConservativeGainDb: does not boost near-silent audio", () => {
  const gainDb = chooseConservativeGainDb({
    meanVolumeDb: -91,
    maxVolumeDb: -91,
    isSilent: true,
  });
  assert.equal(gainDb, 0);
});

test("chooseConservativeGainDb: caps weak mic boosts below the previous maximum", () => {
  const gainDb = chooseConservativeGainDb({
    meanVolumeDb: -42,
    maxVolumeDb: -13.8,
    isSilent: false,
  });
  assert.ok(gainDb > 0, `expected weak mic to still get some boost, got ${gainDb} dB`);
  assert.ok(gainDb <= 4, `expected weak mic boost to be capped conservatively, got ${gainDb} dB`);
});

test("buildSpeechCleanupPlan: prefers arnndn when a model path is available", () => {
  const plan = buildSpeechCleanupPlan("/tmp/test-model.rnnn");
  assert.equal(plan.strategy, "arnndn");
  assert.equal(plan.modelPath, "/tmp/test-model.rnnn");
  assert.ok(plan.filterGraph.includes("arnndn="));
});

test("buildSpeechCleanupPlan: falls back to ffmpeg-only cleanup when no model is available", () => {
  const plan = buildSpeechCleanupPlan(null);
  assert.equal(plan.strategy, "ffmpeg-fallback");
  assert.equal(plan.modelPath, undefined);
  assert.ok(plan.filterGraph.includes("afftdn"));
});

test("cleanMicForSpeech: returns a quality tag alongside the cleaned file", async (t) => {
  if (!(await haveFfmpeg())) {
    t.skip("ffmpeg not available");
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "speech-clean-test-"));
  const micPath = path.join(tmpDir, "mic.wav");
  const cleanedPath = path.join(tmpDir, "mic.voice.wav");

  try {
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi",
      "-i", "anoisesrc=color=pink:sample_rate=48000:duration=2",
      "-f", "lavfi",
      "-i", "sine=frequency=440:sample_rate=48000:duration=2",
      "-filter_complex", "[0:a]volume=0.06[n];[1:a]volume=0.02[s];[n][s]amix=inputs=2[out]",
      "-map", "[out]",
      "-ac", "1",
      "-c:a", "pcm_s16le",
      "-y",
      micPath,
    ]);

    const result = await cleanMicForSpeech(micPath, cleanedPath, {
      info() {},
      warn() {},
      error() {},
    });

    assert.ok(fs.existsSync(cleanedPath), "expected cleaned mic file to be written");
    // quality should track strategy for the happy path.
    assert.ok(
      result.quality === "arnndn-primary" || result.quality === "ffmpeg-fallback",
      `expected a known cleanup quality, got ${result.quality}`
    );
    if (result.strategy === "arnndn") {
      assert.equal(result.quality, "arnndn-primary");
    } else {
      assert.equal(result.quality, "ffmpeg-fallback");
    }
    const info = await analyzeAudioLevels(cleanedPath);
    assert.ok(Number.isFinite(info.meanVolumeDb));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("resolveTrackOffsetMetadata: reads structured per-stream first-sample anchors", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "offset-struct-test-"));
  try {
    const runFolder = path.join(tmpDir, "run");
    const audioRoot = path.join(runFolder, "audio");
    fs.mkdirSync(audioRoot, { recursive: true });
    const micPath = path.join(audioRoot, "mic.wav");
    fs.writeFileSync(micPath, "");
    // Trusted anchors: mic stderr-time, system first-chunk, with a clean
    // 1500ms system-lag and matching end-anchors.
    // Trusted anchors: mic started 1500ms AFTER system (AVFoundation warmup
    // pattern). offsetMs = micFirst − sysFirst = -1500.
    fs.writeFileSync(
      path.join(audioRoot, "capture-meta.json"),
      JSON.stringify({
        mic: {
          firstSampleAtMs: 2500,
          firstSampleSource: "stderr-time",
          endAnchorAtMs: 2500,
        },
        system: {
          firstSampleAtMs: 1000,
          firstSampleSource: "first-chunk",
          endAnchorAtMs: 1000,
        },
      })
    );
    const result = resolveTrackOffsetMetadata(micPath, runFolder);
    assert.deepEqual(result, { offsetMs: 1500, source: "capture-meta" });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("resolveTrackOffsetMetadata: honors timestamp-hint aec.json as truth", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "offset-hint-test-"));
  try {
    const runFolder = path.join(tmpDir, "run");
    const audioRoot = path.join(runFolder, "audio");
    fs.mkdirSync(audioRoot, { recursive: true });
    const micPath = path.join(audioRoot, "mic.wav");
    fs.writeFileSync(micPath, "");
    // Capture-meta would suggest 120ms, but the aec sidecar recorded a
    // hint-anchor decision of 1800ms — the AEC step applied 1800, so the
    // mix must reuse 1800, not 120.
    fs.writeFileSync(
      path.join(audioRoot, "capture-meta.json"),
      JSON.stringify({ micStartedAtMs: 1000, systemStartedAtMs: 1120 })
    );
    fs.writeFileSync(
      path.join(audioRoot, "aec.json"),
      JSON.stringify({ offsetMs: 1800, confidence: 0, source: "timestamp-hint" })
    );
    const result = resolveTrackOffsetMetadata(micPath, runFolder);
    assert.deepEqual(result, { offsetMs: 1800, source: "aec-sidecar" });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("correctStreamDrift: stretches a USB-drop-simulated file to wall-clock duration", async (t) => {
  if (!(await haveFfmpeg())) {
    t.skip("ffmpeg not available");
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "drift-test-"));
  const inputPath = path.join(tmpDir, "mic.wav");

  try {
    // Simulate the real bug: build a 10s-of-content file that declares
    // 48000Hz but represents 11.3s of real wall-clock time (classic USB
    // sample-drop pattern: 44.5s file for 50.2s real, ratio 0.887).
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi",
      "-i", "sine=frequency=440:sample_rate=48000:duration=10",
      "-c:a", "pcm_s16le",
      "-y",
      inputPath,
    ]);

    // The file is 10.0s long. Claim wall-clock capture was 11.3s — i.e.,
    // ~11.5% of samples got dropped.
    const wallClockMs = 11300;
    const result = await correctStreamDrift(inputPath, wallClockMs, {
      logger: { info() {}, warn() {}, error() {} },
    });

    assert.equal(result.applied, true, `expected drift correction to apply, got reason=${result.reason}`);
    assert.equal(result.reason, "stretched");
    assert.ok(result.atempo && result.atempo < 1, `expected atempo<1, got ${result.atempo}`);

    // File should now be ~11.3s (allow 50ms tolerance for atempo rounding).
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet",
      "-show_entries", "format=duration",
      "-of", "default=nokey=1:noprint_wrappers=1",
      inputPath,
    ]);
    const correctedSec = parseFloat(stdout.trim());
    assert.ok(
      Math.abs(correctedSec * 1000 - wallClockMs) < 50,
      `expected corrected duration ~${wallClockMs}ms, got ${correctedSec * 1000}ms`
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("correctStreamDrift: skips correction when deviation is below threshold", async (t) => {
  if (!(await haveFfmpeg())) {
    t.skip("ffmpeg not available");
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "drift-skip-test-"));
  const inputPath = path.join(tmpDir, "mic.wav");

  try {
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi",
      "-i", "sine=frequency=440:sample_rate=48000:duration=5",
      "-c:a", "pcm_s16le",
      "-y",
      inputPath,
    ]);

    // 5.0s file vs 5.03s wall-clock = 0.6% deviation. Below default 1%
    // threshold → should NOT rewrite the file.
    const result = await correctStreamDrift(inputPath, 5030);
    assert.equal(result.applied, false);
    assert.equal(result.reason, "below-threshold");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("resolveTrackOffsetMetadata: prefers end-anchor when start sources are fallback", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "offset-endanchor-test-"));
  try {
    const runFolder = path.join(tmpDir, "run");
    const audioRoot = path.join(runFolder, "audio");
    fs.mkdirSync(audioRoot, { recursive: true });
    const micPath = path.join(audioRoot, "mic.wav");
    fs.writeFileSync(micPath, "");
    // Real-world-ish: start anchors are degraded (spawn-time / tee-start)
    // and only ~8ms apart, but end anchors reveal the mic actually started
    // 3755ms after the system tap. The pipeline MUST pick the end-anchor
    // offset so the mix doesn't desync.
    fs.writeFileSync(
      path.join(audioRoot, "capture-meta.json"),
      JSON.stringify({
        mic: {
          firstSampleAtMs: 1000,
          firstSampleSource: "spawn-time",
          endAnchorAtMs: 4755,
        },
        system: {
          firstSampleAtMs: 1008,
          firstSampleSource: "tee-start",
          endAnchorAtMs: 1000,
        },
      })
    );
    const result = resolveTrackOffsetMetadata(micPath, runFolder);
    // micEnd − sysEnd = 4755 − 1000 = 3755ms.
    assert.deepEqual(result, { offsetMs: 3755, source: "capture-meta" });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("estimateMicSystemOffsetMs: trusted anchors narrow the default search window", async (t) => {
  if (!(await haveFfmpeg())) {
    t.skip("ffmpeg not available");
    return;
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "align-trusted-test-"));
  const micPath = path.join(tmpDir, "mic.wav");
  const sysPath = path.join(tmpDir, "system.wav");
  try {
    // A 1500ms offset would be outside the narrow ±800ms trusted window,
    // so xcorr should NOT recover it when anchorQuality is "trusted" (the
    // caller is saying "the anchor is already close to truth; only refine").
    await makeSyntheticWav(micPath, { durationSec: 5, startDelaySec: 0, seed: 42 });
    await makeSyntheticWav(sysPath, { durationSec: 5, startDelaySec: 1.5, seed: 42 });

    const trusted = await estimateMicSystemOffsetMs(micPath, sysPath, {
      hintOffsetMs: 0,
      anchorQuality: "trusted",
      windowSec: 5,
    });
    // With trusted anchors and a bad hint, xcorr stays inside ±800ms and
    // cannot reach 1500ms — so it should either fail (confidence 0) or
    // report an offset whose magnitude is capped by the narrow radius.
    assert.ok(
      trusted.confidence === 0 || Math.abs(trusted.offsetMs) <= 800,
      `trusted radius should cap xcorr; got ${trusted.offsetMs}ms @ ${trusted.confidence}`
    );

    // With degraded anchors, the wide default kicks in and xcorr should
    // recover the real 1500ms offset from the content.
    const degraded = await estimateMicSystemOffsetMs(micPath, sysPath, {
      hintOffsetMs: 0,
      anchorQuality: "degraded",
      windowSec: 5,
    });
    assert.ok(
      Math.abs(degraded.offsetMs - 1500) <= 30,
      `degraded should recover ~1500ms, got ${degraded.offsetMs} @ ${degraded.confidence}`
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
