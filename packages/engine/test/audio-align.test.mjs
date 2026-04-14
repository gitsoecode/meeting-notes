import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { estimateMicSystemOffsetMs } from "../dist/core/audio.js";

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
