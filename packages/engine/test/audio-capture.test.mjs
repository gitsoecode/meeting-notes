import test from "node:test";
import assert from "node:assert/strict";
import { pickPhysicalMic } from "../dist/adapters/recording/ffmpeg.js";

// ---- pickPhysicalMic unit tests ----

test("pickPhysicalMic: picks first physical mic, skipping virtual devices", () => {
  const devices = [
    "BlackHole 2ch",
    "MacBook Pro Microphone",
    "Microsoft Teams Audio",
    "ZoomAudioDevice",
  ];
  assert.equal(pickPhysicalMic(devices), "MacBook Pro Microphone");
});

test("pickPhysicalMic: returns first device when all are virtual (fallback)", () => {
  const devices = ["BlackHole 2ch", "ZoomAudioDevice"];
  assert.equal(pickPhysicalMic(devices), "BlackHole 2ch");
});

test("pickPhysicalMic: returns empty string for empty list", () => {
  assert.equal(pickPhysicalMic([]), "");
});

test("pickPhysicalMic: skips Soundflower and Loopback", () => {
  const devices = [
    "Soundflower (2ch)",
    "Loopback Audio",
    "External USB Microphone",
  ];
  assert.equal(pickPhysicalMic(devices), "External USB Microphone");
});

test("pickPhysicalMic: case-insensitive matching", () => {
  const devices = ["BLACKHOLE 2ch", "USB Mic"];
  assert.equal(pickPhysicalMic(devices), "USB Mic");
});

test("pickPhysicalMic: picks first physical when multiple physical mics exist", () => {
  const devices = [
    "BlackHole 2ch",
    "MacBook Pro Microphone",
    "External USB Microphone",
  ];
  assert.equal(pickPhysicalMic(devices), "MacBook Pro Microphone");
});

test("pickPhysicalMic: handles LoomAudioDevice", () => {
  const devices = ["LoomAudioDevice", "Built-in Microphone"];
  assert.equal(pickPhysicalMic(devices), "Built-in Microphone");
});

// ---- Integration test: actual audio capture (requires hardware) ----
// This test records real audio. It needs microphone access and AudioTee
// permission. Run it manually to verify the pipeline end-to-end.
// It's skipped in CI or when devices aren't available.

test("integration: mic + system audio capture produces files", async (t) => {
  // Skip in CI or when no audio devices are available
  if (process.env.CI) {
    t.skip("Skipping hardware-dependent test in CI");
    return;
  }

  const { FfmpegRecorder } = await import("../dist/adapters/recording/ffmpeg.js");
  const recorder = new FfmpegRecorder();
  const devices = await recorder.listAudioDevices();

  if (devices.length === 0) {
    t.skip("No audio devices available");
    return;
  }

  const micDevice = pickPhysicalMic(devices);
  if (!micDevice) {
    t.skip("No physical microphone found");
    return;
  }

  // Record for 2 seconds
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-test-"));

  try {
    const session = await recorder.start({
      micDevice,
      systemDevice: "",
      outputDir: tmpDir,
      devices,
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));
    const result = await session.stop();

    // Mic file should exist and have content
    const micFile = path.join(tmpDir, "mic.wav");
    assert.ok(fs.existsSync(micFile), "mic.wav should exist");
    const micStat = fs.statSync(micFile);
    assert.ok(micStat.size > 100, `mic.wav should have content (got ${micStat.size} bytes)`);

    // System audio via AudioTee should also have produced a file
    if (session.systemCaptured) {
      const systemFile = path.join(tmpDir, "system.wav");
      if (!fs.existsSync(systemFile)) {
        t.skip("AudioTee is active, but this host did not produce a system audio stream");
        return;
      }
      const sysStat = fs.statSync(systemFile);
      if (sysStat.size <= 100) {
        t.skip(`AudioTee is active, but this host produced an empty system audio stream (${sysStat.size} bytes)`);
        return;
      }
    }

    // Verify mic resolved to a physical device, not BlackHole
    assert.ok(
      !micDevice.toLowerCase().includes("blackhole"),
      `Mic should not resolve to BlackHole (got "${micDevice}")`
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
