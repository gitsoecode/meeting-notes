import { spawn, ChildProcess, execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import type { Recorder, RecorderOptions, RecordingSession } from "./recorder.js";

const execFileAsync = promisify(execFile);

interface SpawnedRecording {
  child: ChildProcess;
  outputPath: string;
  source: "mic" | "system";
}

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

  async isSystemCaptureAvailable(deviceName: string): Promise<boolean> {
    const devices = await this.listAudioDevices();
    return devices.some((d) => d === deviceName || d.includes(deviceName));
  }

  async start(options: RecorderOptions): Promise<RecordingSession> {
    const audioDir = options.outputDir;
    fs.mkdirSync(audioDir, { recursive: true });

    const startedAt = Date.now();
    const recordings: SpawnedRecording[] = [];

    // Use pre-enumerated device list if provided, otherwise spawn ffmpeg to enumerate.
    const knownDevices = options.devices ?? await this.listAudioDevices();

    // Resolve "system default" (empty mic device) to whatever AVFoundation
    // currently lists first. This makes hot-swapping mics work without a
    // settings round-trip — unplug your USB mic and the next start picks
    // up the built-in input.
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
      requestedSystem: options.systemDevice || "(none)",
    });

    // Always start mic recording
    const micPath = path.join(audioDir, "mic.wav");
    const micChild = spawnFfmpegRecord(micDevice, micPath, this.logger);
    recordings.push({ child: micChild, outputPath: micPath, source: "mic" });

    // Try to start system recording (best-effort)
    let systemAvailable = false;
    if (options.systemDevice) {
      systemAvailable = knownDevices.some((d) => d === options.systemDevice || d.includes(options.systemDevice));
      if (systemAvailable) {
        const systemPath = path.join(audioDir, "system.wav");
        const systemChild = spawnFfmpegRecord(options.systemDevice, systemPath, this.logger);
        recordings.push({ child: systemChild, outputPath: systemPath, source: "system" });
      } else {
        this.logger?.warn("System audio device not found in device list", {
          requested: options.systemDevice,
          available: knownDevices,
        });
      }
    }

    return {
      pids: recordings.map((r) => r.child.pid!).filter((p): p is number => p !== undefined),
      paths: {
        mic: micPath,
        system: systemAvailable ? path.join(audioDir, "system.wav") : undefined,
      },
      systemCaptured: systemAvailable,
      stop: async () => {
        // Send SIGINT to ffmpeg so it flushes the WAV header
        for (const r of recordings) {
          if (r.child.pid && !r.child.killed) {
            try {
              process.kill(r.child.pid, "SIGINT");
            } catch {
              // already exited
            }
          }
        }

        // Wait for all to exit
        await Promise.all(
          recordings.map(
            (r) =>
              new Promise<void>((resolve) => {
                if (r.child.exitCode !== null) {
                  resolve();
                  return;
                }
                r.child.on("exit", () => resolve());
                // Force kill after 5 seconds if it doesn't exit
                setTimeout(() => {
                  if (r.child.pid && !r.child.killed) {
                    try {
                      process.kill(r.child.pid, "SIGKILL");
                    } catch {
                      // ignore
                    }
                  }
                  resolve();
                }, 5000);
              })
          )
        );

        return {
          micPath,
          systemPath: systemAvailable ? path.join(audioDir, "system.wav") : undefined,
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
