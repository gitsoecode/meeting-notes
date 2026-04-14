import { spawn, ChildProcess, execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Recorder, RecorderOptions, RecordingSession } from "./recorder.js";
import { startAudioTeeCapture, type AudioTeeSession } from "./audiotee-recorder.js";
import {
  resolveNativeMicBinary,
  startNativeMic,
  type NativeMicSession,
} from "./native-mic-recorder.js";

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
    const finalAudioDir = options.outputDir;
    fs.mkdirSync(finalAudioDir, { recursive: true });

    // Real-time audio capture is highly sensitive to writer stalls. If the
    // final target is on a slow or networked volume (e.g., a cloud-sync
    // folder like Synology Drive), brief I/O pauses cascade into USB
    // ring-buffer overruns and dropped samples. Record into a local
    // scratch directory on the system tmp filesystem, then move the
    // finalized files into `finalAudioDir` on stop(). `os.tmpdir()` is
    // guaranteed to be on a fast local volume.
    const captureScratchDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "mn-capture-")
    );

    const startedAt = Date.now();

    // Use pre-enumerated device list if provided, otherwise spawn ffmpeg to enumerate.
    const knownDevices = options.devices ?? await this.listAudioDevices();

    // Resolve "system default" or empty mic device to the first physical
    // microphone. Virtual/loopback devices (BlackHole, Zoom, Loom, Teams,
    // etc.) should never be auto-selected — they exist for routing and
    // produce silence unless explicitly configured as an audio source.
    let micDevice = options.micDevice;
    if (!micDevice || micDevice.trim() === "" || micDevice === "default") {
      micDevice = pickPhysicalMic(knownDevices);
      if (!micDevice) {
        throw new Error("No audio input devices available (system default requested but ffmpeg listed none)");
      }
    }

    this.logger?.info("Audio devices available", {
      devices: knownDevices,
      requestedMic: options.micDevice || "(system default)",
      resolvedMic: micDevice,
    });

    // Start mic recording — into scratch.
    //
    // Preferred backend: SoX (CoreAudio HAL driver). ffmpeg's AVFoundation
    // audio demuxer drops ~10–12% of samples from USB microphones on
    // macOS 14+; SoX does not. Falls back to ffmpeg AVFoundation when no
    // sox binary is available (degraded mode, drift correction compensates).
    const scratchMicPath = path.join(captureScratchDir, "mic.wav");
    const finalMicPath = path.join(finalAudioDir, "mic.wav");
    const spawnTimeMs = Date.now();
    const micTiming: {
      firstSampleAtMs?: number;
      firstSampleSource?:
        | "mic-capture-first-sample"
        | "stderr-time"
        | "spawn-time";
      stoppedAtMs?: number;
    } = {
      firstSampleAtMs: spawnTimeMs,
      firstSampleSource: "spawn-time",
    };

    // Prefer the bundled native `mic-capture` helper (no third-party
    // dependencies, clean CoreAudio delivery). Fall back to ffmpeg's
    // AVFoundation demuxer only if the helper is missing — that path
    // drops ~10–12% of samples and runs in degraded mode.
    const nativeMicBinary =
      options.micCaptureBinaryPath ?? resolveNativeMicBinary();
    let micPid: number | undefined;
    let micStopFn: () => Promise<void>;

    if (nativeMicBinary) {
      this.logger?.info("Mic capture: using native CoreAudio helper", {
        binaryPath: nativeMicBinary,
      });
      const nativeSession: NativeMicSession = startNativeMic({
        binaryPath: nativeMicBinary,
        outputPath: scratchMicPath,
        logger: this.logger,
        onFirstSample: () => {
          if (micTiming.firstSampleSource !== "mic-capture-first-sample") {
            micTiming.firstSampleAtMs = Date.now();
            micTiming.firstSampleSource = "mic-capture-first-sample";
          }
        },
      });
      micPid = nativeSession.pid || undefined;
      micStopFn = () => nativeSession.stop();
    } else {
      this.logger?.warn(
        "Mic capture: native helper missing — falling back to ffmpeg AVFoundation (degraded; expect ~10–12% sample drops that drift correction will stretch back to wall-clock).",
        {}
      );
      const micChild = spawnFfmpegRecord(micDevice, scratchMicPath, this.logger, (parsedTimeMs) => {
        if (micTiming.firstSampleSource !== "stderr-time") {
          micTiming.firstSampleAtMs = Date.now() - parsedTimeMs;
          micTiming.firstSampleSource = "stderr-time";
        }
      });
      micPid = micChild.pid;
      micStopFn = async () => {
        if (micChild.pid && !micChild.killed) {
          try {
            process.kill(micChild.pid, "SIGINT");
          } catch {
            // already exited
          }
        }
        await new Promise<void>((resolve) => {
          if (micChild.exitCode !== null) return resolve();
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
      };
    }

    // Start system audio capture via AudioTee (macOS 14.2+, no BlackHole needed)
    const finalSystemPath = path.join(finalAudioDir, "system.wav");
    let audioTeeSession: AudioTeeSession | null = null;
    let systemCaptured = false;
    try {
      audioTeeSession = await startAudioTeeCapture({
        outputDir: captureScratchDir,
        sampleRate: 48000,
        binaryPath: options.audioTeeBinaryPath,
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

    const scratchSystemPath = systemCaptured ? audioTeeSession!.systemPath : undefined;
    const systemPath = systemCaptured ? finalSystemPath : undefined;

    // NOTE: `captureMeta` below is built once on session construction, but
    // populated with final values in stop() — not here. The first-sample
    // anchors (stderr `time=` for mic, first `data` chunk for AudioTee) are
    // upgraded *asynchronously* after spawn, so snapshotting them at this
    // point would always ship the degraded fallback sources.
    const captureMeta: RecordingSession["captureMeta"] = {};
    const logger = this.logger;
    const session: RecordingSession = {
      pids: [micPid].filter((p): p is number => p !== undefined),
      paths: {
        mic: finalMicPath,
        system: systemPath,
      },
      systemCaptured,
      captureMeta,
      stop: async () => {
        micTiming.stoppedAtMs = Date.now();
        // Stop mic (sox or ffmpeg) — both send SIGINT and await exit.
        await micStopFn();

        // Stop system audio (AudioTee)
        if (audioTeeSession?.started) {
          await audioTeeSession.stop();
        }

        // Move finalized files from scratch to the real run folder. On the
        // same volume this is an atomic rename; cross-volume falls back to
        // copy+unlink. The move happens AFTER both captures have stopped
        // and their files are fully written, so the user-visible location
        // never sees a partial file.
        try {
          await moveFile(scratchMicPath, finalMicPath);
        } catch (err) {
          logger?.warn("Failed to move scratch mic.wav into run folder", {
            from: scratchMicPath,
            to: finalMicPath,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        if (systemCaptured && scratchSystemPath) {
          try {
            await moveFile(scratchSystemPath, finalSystemPath);
          } catch (err) {
            logger?.warn("Failed to move scratch system.wav into run folder", {
              from: scratchSystemPath,
              to: finalSystemPath,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        // Best-effort scratch cleanup.
        try {
          fs.rmSync(captureScratchDir, { recursive: true, force: true });
        } catch {
          // Non-fatal — tmpdir gets swept by the OS eventually.
        }

        // Populate end-anchor metadata now that the file is finalized.
        // ffprobe is authoritative for what's on disk. Probe the FINAL
        // path so the end-anchor reflects the bytes the pipeline will see.
        let micDurationMs: number | undefined;
        try {
          const probed = await probeDurationMs(finalMicPath);
          if (probed > 0) micDurationMs = probed;
        } catch {
          // Best-effort — end anchor is optional.
        }

        // Build the final capture-meta now, after all asynchronous first-
        // sample callbacks have had a chance to fire and after durations
        // are known on disk.
        captureMeta.micStartedAtMs = micTiming.firstSampleAtMs;
        captureMeta.systemStartedAtMs = audioTeeSession?.startedAtMs;
        captureMeta.mic = {
          firstSampleAtMs: micTiming.firstSampleAtMs,
          firstSampleSource: micTiming.firstSampleSource,
          stoppedAtMs: micTiming.stoppedAtMs,
          durationMs: micDurationMs,
          endAnchorAtMs:
            micDurationMs !== undefined && micTiming.stoppedAtMs !== undefined
              ? micTiming.stoppedAtMs - micDurationMs
              : undefined,
        };
        if (systemCaptured && audioTeeSession) {
          captureMeta.system = {
            firstSampleAtMs: audioTeeSession.startedAtMs,
            firstSampleSource: audioTeeSession.startedAtSource,
            stoppedAtMs: audioTeeSession.stoppedAtMs,
            durationMs: audioTeeSession.durationMs,
            endAnchorAtMs:
              audioTeeSession.durationMs !== undefined &&
              audioTeeSession.stoppedAtMs !== undefined
                ? audioTeeSession.stoppedAtMs - audioTeeSession.durationMs
                : undefined,
          };
        }

        return {
          micPath: finalMicPath,
          systemPath,
          durationMs: Date.now() - startedAt,
        };
      },
    };
    return session;
  }
}

async function moveFile(src: string, dst: string): Promise<void> {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try {
    fs.renameSync(src, dst);
  } catch (err) {
    // EXDEV / cross-device: fall back to copy + unlink.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EXDEV") {
      fs.copyFileSync(src, dst);
      try { fs.unlinkSync(src); } catch {}
      return;
    }
    throw err;
  }
}

async function probeDurationMs(audioPath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet",
    "-show_entries", "format=duration",
    "-of", "default=nokey=1:noprint_wrappers=1",
    audioPath,
  ]);
  const seconds = parseFloat(stdout.trim());
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
}

function spawnFfmpegRecord(
  deviceName: string,
  outputPath: string,
  logger?: DiagnosticLogger,
  onFirstStatusLine?: (parsedTimeMs: number) => void
): ChildProcess {
  // AVFoundation audio-only input syntax: ":deviceName" or ":index"
  // Use device name as-is; AVFoundation accepts names directly
  const inputSpec = `:${deviceName}`;

  const args = [
    "-f", "avfoundation",
    // Expand the input queue between avfoundation and the muxer from its
    // default of 8 packets. When the writer briefly stalls (disk I/O
    // blip, GC pause, etc.) the default tiny queue overflows and the
    // kernel/driver drop samples at the USB boundary. 1024 is a common
    // value that gives the capture thread ~5 s of headroom at typical
    // audio packet sizes without meaningfully increasing memory use.
    "-thread_queue_size", "1024",
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
  let firstStatusLineFired = false;
  const firstStatusRx = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/;
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stderrChunks.push(text);
    // Cap memory: keep only the last ~32 KB of stderr.
    if (stderrChunks.length > 100) stderrChunks = stderrChunks.slice(-50);

    if (!firstStatusLineFired && onFirstStatusLine) {
      const m = text.match(firstStatusRx);
      if (m) {
        firstStatusLineFired = true;
        const hours = parseInt(m[1], 10);
        const minutes = parseInt(m[2], 10);
        const seconds = parseFloat(m[3]);
        const parsedTimeMs = Math.round(
          (hours * 3600 + minutes * 60 + seconds) * 1000
        );
        try {
          onFirstStatusLine(parsedTimeMs);
        } catch {
          // Swallow — timing hook failures must not crash capture.
        }
      }
    }
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

/**
 * Known virtual/loopback audio device name fragments. These devices are
 * used for inter-app audio routing and produce silence unless something
 * is explicitly sending audio to them. They should never be auto-selected
 * as the "default" microphone.
 */
const VIRTUAL_DEVICE_PATTERNS = [
  "blackhole",
  "zoomaudiodevice",
  "loomaudiodevice",
  "microsoft teams audio",
  "soundflower",
  "loopback",
  "virtual",
  "aggregate",
];

/**
 * Pick the first physical (non-virtual) microphone from the device list.
 * Falls back to the first device if no physical mic is found (better than
 * failing outright).
 */
export function pickPhysicalMic(devices: string[]): string {
  const physical = devices.find(
    (d) => !VIRTUAL_DEVICE_PATTERNS.some((p) => d.toLowerCase().includes(p))
  );
  return physical ?? devices[0] ?? "";
}
