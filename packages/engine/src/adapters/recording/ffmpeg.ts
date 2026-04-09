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

export class FfmpegRecorder implements Recorder {
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

    // Resolve "system default" (empty mic device) to whatever AVFoundation
    // currently lists first. This makes hot-swapping mics work without a
    // settings round-trip — unplug your USB mic and the next start picks
    // up the built-in input.
    let micDevice = options.micDevice;
    if (!micDevice || micDevice.trim() === "") {
      const devices = await this.listAudioDevices();
      micDevice = devices[0] ?? "";
      if (!micDevice) {
        throw new Error("No audio input devices available (system default requested but ffmpeg listed none)");
      }
    }

    // Always start mic recording
    const micPath = path.join(audioDir, "mic.wav");
    const micChild = spawnFfmpegRecord(micDevice, micPath);
    recordings.push({ child: micChild, outputPath: micPath, source: "mic" });

    // Try to start system recording (best-effort)
    let systemAvailable = false;
    if (options.systemDevice) {
      systemAvailable = await this.isSystemCaptureAvailable(options.systemDevice);
      if (systemAvailable) {
        const systemPath = path.join(audioDir, "system.wav");
        const systemChild = spawnFfmpegRecord(options.systemDevice, systemPath);
        recordings.push({ child: systemChild, outputPath: systemPath, source: "system" });
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

function spawnFfmpegRecord(deviceName: string, outputPath: string): ChildProcess {
  // AVFoundation audio-only input syntax: ":deviceName" or ":index"
  // Use device name as-is; AVFoundation accepts names directly
  const inputSpec = `:${deviceName}`;

  const args = [
    "-f", "avfoundation",
    "-i", inputSpec,
    "-ar", "16000",
    "-ac", "1",
    "-c:a", "pcm_s16le",
    "-y",
    outputPath,
  ];

  // Run as a foreground child of the CLI: the `start` command now waits
  // interactively for the user to press Enter, so we want predictable
  // SIGINT propagation and no stray pipes keeping the event loop alive.
  const child = spawn("ffmpeg", args, {
    stdio: ["ignore", "ignore", "ignore"],
  });

  return child;
}
