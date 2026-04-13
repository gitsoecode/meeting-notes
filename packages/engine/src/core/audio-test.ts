import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { FfmpegRecorder } from "../adapters/recording/ffmpeg.js";
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
 * Record a short clip from each configured audio device and analyze the
 * results. This lets the user verify their setup is working without
 * needing a real meeting.
 */
export async function testAudioCapture(opts: {
  micDevice: string;
  systemDevice: string;
  durationMs?: number;
}): Promise<AudioTestReport> {
  const durationMs = opts.durationMs ?? 4000;
  const recorder = new FfmpegRecorder();
  const devices = await recorder.listAudioDevices();

  // Resolve system default
  let micDevice = opts.micDevice;
  if (!micDevice || micDevice.trim() === "") {
    micDevice = devices[0] ?? "";
  }

  const results: DeviceTestResult[] = [];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meeting-notes-audio-test-"));

  try {
    // Test mic device
    results.push(await testDevice(recorder, devices, micDevice, "mic", tmpDir, durationMs));

    // Test system device
    if (opts.systemDevice) {
      results.push(await testDevice(recorder, devices, opts.systemDevice, "system", tmpDir, durationMs));
    }
  } finally {
    // Clean up temp files
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return {
    devices,
    micDevice,
    systemDevice: opts.systemDevice,
    results,
  };
}

async function testDevice(
  recorder: FfmpegRecorder,
  knownDevices: string[],
  deviceName: string,
  role: "mic" | "system",
  tmpDir: string,
  durationMs: number
): Promise<DeviceTestResult> {
  const found = knownDevices.some(
    (d) => d === deviceName || d.includes(deviceName)
  );

  if (!found) {
    return {
      deviceName,
      role,
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

  const outputPath = path.join(tmpDir, `${role}.wav`);

  try {
    const session = await recorder.start({
      micDevice: role === "mic" ? deviceName : "",
      systemDevice: role === "system" ? deviceName : "",
      outputDir: tmpDir,
      devices: knownDevices,
    });

    // Wait for the test duration
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    await session.stop();

    // The file will be mic.wav or system.wav depending on which device was set
    const testFile = role === "mic"
      ? path.join(tmpDir, "mic.wav")
      : path.join(tmpDir, "system.wav");

    if (!fs.existsSync(testFile)) {
      return {
        deviceName,
        role,
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

    // Clean up for next test
    fs.unlinkSync(testFile);
    const otherFile = role === "mic"
      ? path.join(tmpDir, "system.wav")
      : path.join(tmpDir, "mic.wav");
    if (fs.existsSync(otherFile)) fs.unlinkSync(otherFile);

    return {
      deviceName,
      role,
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
      role,
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
