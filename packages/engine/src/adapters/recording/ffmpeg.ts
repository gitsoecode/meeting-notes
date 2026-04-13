import { spawn, ChildProcess, execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import type { Recorder, RecorderOptions, RecordingSession } from "./recorder.js";
import { startAudioTeeCapture, type AudioTeeSession } from "./audiotee-recorder.js";

const execFileAsync = promisify(execFile);

type DiagnosticLogger = {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
};

export class FfmpegRecorder implements Recorder {
  private logger?: DiagnosticLogger;

  constructor(logger?: DiagnosticLogger) {
    this.logger = logger;
  }

  async listAudioDevices(): Promise<string[]> {
    try {
      // ffmpeg writes device list to stderr, exits with non-zero
      const result = await execFileAsync(
        "ffmpeg",
        ["-f", "avfoundation", "-list_devices", "true", "-i", ""],
        { encoding: "utf-8" }
      ).catch((e) => ({ stderr: e.stderr as string }));

      const stderr = "stderr" in result ? result.stderr : "";
      const audioSection = stderr.split("AVFoundation audio devices:")[1] ?? "";
      const devices: string[] = [];
      for (const line of audioSection.split("\n")) {
        const match = line.match(/\[(\d+)\]\s(.+)$/);
        if (match) {
          devices.push(match[2].trim());
        }
      }
      return devices;
    } catch {
      return [];
    }
  }

  async isSystemCaptureAvailable(_deviceName: string): Promise<boolean> {
    // AudioTee handles system audio capture natively on macOS 14.2+.
    // No device name matching required.
    return process.platform === "darwin";
  }

  async start(options: RecorderOptions): Promise<RecordingSession> {
    const audioDir = options.outputDir;
    fs.mkdirSync(audioDir, { recursive: true });

    const startedAt = Date.now();

    // Use pre-enumerated device list if provided, otherwise spawn ffmpeg to enumerate.
    const knownDevices = options.devices ?? await this.listAudioDevices();

    // Resolve "system default" (empty mic device) to whatever AVFoundation
    // currently lists first.
    let micDevice = options.micDevice;
    if (!micDevice || micDevice.trim() === "") {
      micDevice = knownDevices[0] ?? "";
      if (!micDevice) {
        throw new Error("No audio input devices available (system default requested but ffmpeg listed none)");
      }
    }

    this.logger?.info("Audio devices available", {
      devices: knownDevices,
      requestedMic: options.micDevice || "(system default)",
      resolvedMic: micDevice,
    });

    // Start mic recording via ffmpeg
    const micPath = path.join(audioDir, "mic.wav");
    const micChild = spawnFfmpegRecord(micDevice, micPath, this.logger);

    // Start system audio capture via AudioTee (macOS 14.2+, no BlackHole needed)
    let audioTeeSession: AudioTeeSession | null = null;
    let systemCaptured = false;
    try {
      audioTeeSession = await startAudioTeeCapture({
        outputDir: audioDir,
        sampleRate: 48000,
        onError: (err) => {
          this.logger?.error("AudioTee system capture error", {
            error: err.message,
          });
        },
      });
      systemCaptured = audioTeeSession.started;
      if (systemCaptured) {
        this.logger?.info("System audio capture started via AudioTee");
      } else {
        this.logger?.warn("AudioTee failed to start — recording mic only. System audio capture requires macOS 14.2+ and the System Audio Recording permission.");
      }
    } catch (err) {
      this.logger?.warn("AudioTee unavailable — recording mic only", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const systemPath = systemCaptured ? audioTeeSession!.systemPath : undefined;

    return {
      pids: [micChild.pid!].filter((p): p is number => p !== undefined),
      paths: {
        mic: micPath,
        system: systemPath,
      },
      systemCaptured,
      stop: async () => {
        // Stop mic (ffmpeg) via SIGINT
        if (micChild.pid && !micChild.killed) {
          try {
            process.kill(micChild.pid, "SIGINT");
          } catch {
            // already exited
          }
        }

        // Stop system audio (AudioTee)
        if (audioTeeSession?.started) {
          await audioTeeSession.stop();
        }

        // Wait for ffmpeg to exit
        await new Promise<void>((resolve) => {
          if (micChild.exitCode !== null) {
            resolve();
            return;
          }
          micChild.on("exit", () => resolve());
          setTimeout(() => {
            if (micChild.pid && !micChild.killed) {
              try {
                process.kill(micChild.pid, "SIGKILL");
              } catch {
                // ignore
              }
            }
            resolve();
          }, 5000);
        });

        return {
          micPath,
          systemPath,
          durationMs: Date.now() - startedAt,
        };
      },
    };
  }
}

function spawnFfmpegRecord(deviceName: string, outputPath: string, logger?: DiagnosticLogger): ChildProcess {
  // AVFoundation audio-only input syntax: ":deviceName" or ":index"
  // Use device name as-is; AVFoundation accepts names directly
  const inputSpec = `:${deviceName}`;

  const args = [
    "-f", "avfoundation",
    "-i", inputSpec,
    // Record at the device's native sample rate to avoid real-time
    // resampling, which can cause choppy audio under load. The
    // normalizeAudio step downsamples to 16 kHz before ASR.
    "-c:a", "pcm_s16le",
    "-y",
    outputPath,
  ];

  const child = spawn("ffmpeg", args, {
    stdio: ["ignore", "ignore", "pipe"],
  });

  // Collect stderr for diagnostics on non-zero exit.
  let stderrChunks: string[] = [];
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrChunks.push(chunk.toString());
    // Cap memory: keep only the last ~32 KB of stderr.
    if (stderrChunks.length > 100) stderrChunks = stderrChunks.slice(-50);
  });
  child.on("exit", (code, signal) => {
    if (code !== 0 && code !== null && signal !== "SIGINT") {
      const stderr = stderrChunks.join("").slice(-2000);
      logger?.error(`ffmpeg exited with code ${code} for device "${deviceName}"`, {
        exitCode: code,
        signal,
        stderr,
      });
    }
  });

  return child;
}
