import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { FfmpegRecorder, pickPhysicalMic } from "../adapters/recording/ffmpeg.js";
import { startAudioTeeCapture } from "../adapters/recording/audiotee-recorder.js";
import { checkAudioSilence } from "./audio.js";

export interface DeviceTestResult {
  deviceName: string;
  role: "mic" | "system";
  found: boolean;
  recorded: boolean;
  fileSizeBytes: number;
  durationSeconds: number;
  meanVolumeDb: number;
  maxVolumeDb: number;
  isSilent: boolean;
  error?: string;
}

export interface AudioTestReport {
  devices: string[];
  micDevice: string;
  systemDevice: string;
  results: DeviceTestResult[];
}

/**
 * Record a short clip from mic (via ffmpeg) and system audio (via AudioTee)
 * and analyze the results. This lets the user verify their setup is working
 * without needing a real meeting.
 */
export async function testAudioCapture(opts: {
  micDevice: string;
  systemDevice: string;
  durationMs?: number;
}): Promise<AudioTestReport> {
  const durationMs = opts.durationMs ?? 4000;
  const recorder = new FfmpegRecorder();
  const devices = await recorder.listAudioDevices();

  // Resolve mic device using smart selection (skips virtual devices)
  let micDevice = opts.micDevice;
  if (!micDevice || micDevice.trim() === "" || micDevice === "default") {
    micDevice = pickPhysicalMic(devices);
  }

  const results: DeviceTestResult[] = [];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meeting-notes-audio-test-"));

  try {
    // Test mic device via ffmpeg
    results.push(await testMicDevice(recorder, devices, micDevice, tmpDir, durationMs));

    // Test system audio via AudioTee (not device-based anymore)
    results.push(await testSystemAudioTee(tmpDir, durationMs));
  } finally {
    // Clean up temp files
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return {
    devices,
    micDevice,
    systemDevice: "(AudioTee)",
    results,
  };
}

async function testMicDevice(
  recorder: FfmpegRecorder,
  knownDevices: string[],
  deviceName: string,
  tmpDir: string,
  durationMs: number
): Promise<DeviceTestResult> {
  const found = knownDevices.some(
    (d) => d === deviceName || d.includes(deviceName)
  );

  if (!found) {
    return {
      deviceName,
      role: "mic",
      found: false,
      recorded: false,
      fileSizeBytes: 0,
      durationSeconds: 0,
      meanVolumeDb: -91,
      maxVolumeDb: -91,
      isSilent: true,
      error: `Device "${deviceName}" not found in available devices: ${knownDevices.join(", ")}`,
    };
  }

  const outputPath = path.join(tmpDir, "mic.wav");

  try {
    const session = await recorder.start({
      micDevice: deviceName,
      systemDevice: "",
      outputDir: tmpDir,
      devices: knownDevices,
    });

    // Wait for the test duration
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    await session.stop();

    const testFile = path.join(tmpDir, "mic.wav");

    if (!fs.existsSync(testFile)) {
      return {
        deviceName,
        role: "mic",
        found: true,
        recorded: false,
        fileSizeBytes: 0,
        durationSeconds: durationMs / 1000,
        meanVolumeDb: -91,
        maxVolumeDb: -91,
        isSilent: true,
        error: "Recording file was not created",
      };
    }

    const stat = fs.statSync(testFile);
    const silence = await checkAudioSilence(testFile);

    return {
      deviceName,
      role: "mic",
      found: true,
      recorded: stat.size > 100,
      fileSizeBytes: stat.size,
      durationSeconds: durationMs / 1000,
      meanVolumeDb: silence.meanVolumeDb,
      maxVolumeDb: silence.maxVolumeDb,
      isSilent: silence.isSilent,
    };
  } catch (err) {
    return {
      deviceName,
      role: "mic",
      found: true,
      recorded: false,
      fileSizeBytes: 0,
      durationSeconds: 0,
      meanVolumeDb: -91,
      maxVolumeDb: -91,
      isSilent: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Test system audio capture via AudioTee. Records for the given duration
 * and checks that the captured WAV file contains non-silent audio.
 */
async function testSystemAudioTee(
  tmpDir: string,
  durationMs: number
): Promise<DeviceTestResult> {
  const deviceName = "AudioTee (CoreAudio tap)";
  const systemDir = path.join(tmpDir, "system-test");

  try {
    const session = await startAudioTeeCapture({
      outputDir: systemDir,
      sampleRate: 48000,
      onError: (err) => {
        // captured below via session.started
        void err;
      },
    });

    if (!session.started) {
      return {
        deviceName,
        role: "system",
        found: false,
        recorded: false,
        fileSizeBytes: 0,
        durationSeconds: 0,
        meanVolumeDb: -91,
        maxVolumeDb: -91,
        isSilent: true,
        error: "AudioTee failed to start. System audio capture requires macOS 14.2+ and the System Audio Recording permission in System Settings → Privacy & Security.",
      };
    }

    // Wait for the test duration
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    await session.stop();

    const testFile = session.systemPath;

    if (!fs.existsSync(testFile)) {
      return {
        deviceName,
        role: "system",
        found: true,
        recorded: false,
        fileSizeBytes: 0,
        durationSeconds: durationMs / 1000,
        meanVolumeDb: -91,
        maxVolumeDb: -91,
        isSilent: true,
        error: "System audio WAV file was not created after recording",
      };
    }

    const stat = fs.statSync(testFile);
    const silence = await checkAudioSilence(testFile);

    return {
      deviceName,
      role: "system",
      found: true,
      recorded: stat.size > 100,
      fileSizeBytes: stat.size,
      durationSeconds: durationMs / 1000,
      meanVolumeDb: silence.meanVolumeDb,
      maxVolumeDb: silence.maxVolumeDb,
      isSilent: silence.isSilent,
    };
  } catch (err) {
    return {
      deviceName,
      role: "system",
      found: true,
      recorded: false,
      fileSizeBytes: 0,
      durationSeconds: 0,
      meanVolumeDb: -91,
      maxVolumeDb: -91,
      isSilent: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
