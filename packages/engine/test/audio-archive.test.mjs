import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  decodeAudioToWav,
  encodeAudioArchive,
  getAudioInfo,
} from "../dist/core/audio.js";
import {
  compactProcessedAudio,
  prepareAudioFilesForProcessing,
} from "../dist/core/process-run.js";

const execFileAsync = promisify(execFile);

async function haveFfmpeg() {
  try {
    await execFileAsync("ffmpeg", ["-hide_banner", "-version"]);
    return true;
  } catch {
    return false;
  }
}

async function makeVoiceLikeWav(outPath, durationSec = 1) {
  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:sample_rate=48000:duration=${durationSec}`,
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    "-y",
    outPath,
  ]);
}

function logger(warnings = []) {
  return {
    info() {},
    warn(message, data) {
      warnings.push({ message, data });
    },
    error() {},
  };
}

test("compactProcessedAudio: compact mode encodes sources and combined playback to Opus", async (t) => {
  if (!(await haveFfmpeg())) {
    t.skip("ffmpeg not available");
    return;
  }

  const runFolder = fs.mkdtempSync(path.join(os.tmpdir(), "archive-compact-"));
  const audioDir = path.join(runFolder, "audio");
  fs.mkdirSync(audioDir, { recursive: true });
  const mic = path.join(audioDir, "mic.wav");
  const system = path.join(audioDir, "system.wav");
  const combined = path.join(audioDir, "combined.wav");
  await makeVoiceLikeWav(mic);
  await makeVoiceLikeWav(system);
  await makeVoiceLikeWav(combined);

  try {
    await compactProcessedAudio({
      config: { audio_storage_mode: "compact" },
      runFolder,
      trackContexts: [
        { path: mic, speaker: "me" },
        { path: system, speaker: "others" },
      ],
      compactSources: true,
      logger: logger(),
    });

    assert.equal(fs.existsSync(mic), false);
    assert.equal(fs.existsSync(system), false);
    assert.equal(fs.existsSync(combined), false);
    assert.ok(fs.existsSync(path.join(audioDir, "mic.ogg")));
    assert.ok(fs.existsSync(path.join(audioDir, "system.ogg")));
    assert.ok(fs.existsSync(path.join(audioDir, "combined.ogg")));
  } finally {
    fs.rmSync(runFolder, { recursive: true, force: true });
  }
});

test("compactProcessedAudio: lossless mode keeps sources as FLAC and playback as Opus", async (t) => {
  if (!(await haveFfmpeg())) {
    t.skip("ffmpeg not available");
    return;
  }

  const runFolder = fs.mkdtempSync(path.join(os.tmpdir(), "archive-lossless-"));
  const audioDir = path.join(runFolder, "audio");
  fs.mkdirSync(audioDir, { recursive: true });
  const mic = path.join(audioDir, "mic.wav");
  const system = path.join(audioDir, "system.wav");
  const combined = path.join(audioDir, "combined.wav");
  await makeVoiceLikeWav(mic);
  await makeVoiceLikeWav(system);
  await makeVoiceLikeWav(combined);

  try {
    await compactProcessedAudio({
      config: { audio_storage_mode: "lossless" },
      runFolder,
      trackContexts: [
        { path: mic, speaker: "me" },
        { path: system, speaker: "others" },
      ],
      compactSources: true,
      logger: logger(),
    });

    assert.equal(fs.existsSync(mic), false);
    assert.equal(fs.existsSync(system), false);
    assert.equal(fs.existsSync(combined), false);
    assert.ok(fs.existsSync(path.join(audioDir, "mic.flac")));
    assert.ok(fs.existsSync(path.join(audioDir, "system.flac")));
    assert.ok(fs.existsSync(path.join(audioDir, "combined.ogg")));
  } finally {
    fs.rmSync(runFolder, { recursive: true, force: true });
  }
});

test("compactProcessedAudio: failed source encode leaves WAV intact", async (t) => {
  if (!(await haveFfmpeg())) {
    t.skip("ffmpeg not available");
    return;
  }

  const runFolder = fs.mkdtempSync(path.join(os.tmpdir(), "archive-failure-"));
  const audioDir = path.join(runFolder, "audio");
  fs.mkdirSync(audioDir, { recursive: true });
  const mic = path.join(audioDir, "mic.wav");
  fs.writeFileSync(mic, "not a real wav");
  const warnings = [];

  try {
    await compactProcessedAudio({
      config: { audio_storage_mode: "compact" },
      runFolder,
      trackContexts: [{ path: mic, speaker: "me" }],
      compactSources: true,
      logger: logger(warnings),
    });

    assert.equal(fs.existsSync(mic), true);
    assert.equal(fs.existsSync(path.join(audioDir, "mic.ogg")), false);
    assert.ok(warnings.some((entry) => entry.message === "Failed to compact source audio"));
  } finally {
    fs.rmSync(runFolder, { recursive: true, force: true });
  }
});

test("prepareAudioFilesForProcessing: archived sources decode to scratch WAVs without mutating archives", async (t) => {
  if (!(await haveFfmpeg())) {
    t.skip("ffmpeg not available");
    return;
  }

  const runFolder = fs.mkdtempSync(path.join(os.tmpdir(), "archive-reprocess-"));
  const segmentDir = path.join(runFolder, "audio", "2026-04-25_10-00-00-000");
  fs.mkdirSync(segmentDir, { recursive: true });
  const micWav = path.join(segmentDir, "mic.wav");
  const systemWav = path.join(segmentDir, "system.wav");
  const micOgg = path.join(segmentDir, "mic.ogg");
  const systemFlac = path.join(segmentDir, "system.flac");
  await makeVoiceLikeWav(micWav);
  await makeVoiceLikeWav(systemWav);
  fs.writeFileSync(path.join(segmentDir, "capture-meta.json"), "{}");
  await encodeAudioArchive(micWav, micOgg, "ogg-opus", { bitrateKbps: 48 });
  await encodeAudioArchive(systemWav, systemFlac, "flac");
  fs.rmSync(micWav);
  fs.rmSync(systemWav);
  const beforeMicBytes = fs.statSync(micOgg).size;
  const beforeSystemBytes = fs.statSync(systemFlac).size;

  try {
    const prepared = await prepareAudioFilesForProcessing(
      [
        { path: micOgg, speaker: "me" },
        { path: systemFlac, speaker: "others" },
      ],
      runFolder,
      logger()
    );

    assert.ok(prepared.scratchDir.startsWith(path.join(runFolder, ".processing-work")));
    assert.deepEqual(
      prepared.audioFiles.map((file) => path.basename(file.path)),
      ["mic.wav", "system.wav"]
    );
    for (const file of prepared.audioFiles) {
      assert.ok(fs.existsSync(file.path));
      const info = await getAudioInfo(file.path);
      assert.ok(info.durationMs > 0);
    }
    assert.ok(fs.existsSync(path.join(path.dirname(prepared.audioFiles[0].path), "capture-meta.json")));
    assert.equal(fs.statSync(micOgg).size, beforeMicBytes);
    assert.equal(fs.statSync(systemFlac).size, beforeSystemBytes);
  } finally {
    fs.rmSync(runFolder, { recursive: true, force: true });
  }
});

test("decodeAudioToWav: failed decode leaves source archive intact", async () => {
  const runFolder = fs.mkdtempSync(path.join(os.tmpdir(), "archive-decode-failure-"));
  const archive = path.join(runFolder, "mic.ogg");
  const decoded = path.join(runFolder, "mic.wav");
  fs.writeFileSync(archive, "not a real ogg");

  try {
    await assert.rejects(() => decodeAudioToWav(archive, decoded), /Failed to decode audio archive/);
    assert.equal(fs.existsSync(archive), true);
    assert.equal(fs.existsSync(decoded), false);
  } finally {
    fs.rmSync(runFolder, { recursive: true, force: true });
  }
});
