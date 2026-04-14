import { spawn, ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Microphone capture via a bundled native CoreAudio helper (`mic-capture`).
 *
 * Why not ffmpeg's avfoundation? Its audio demuxer drops ~10–12% of
 * samples continuously on USB microphones under macOS 14+. The native
 * helper uses AVAudioEngine directly and only loses a fixed ~300–500 ms
 * at startup (before the hardware begins delivering buffers); the engine
 * drift-correction step stretches that back to wall-clock.
 *
 * The helper is shipped with the app — no Homebrew or third-party
 * packages required on the user's machine. See
 * `packages/app/native/mic-capture.swift` for the source and
 * `packages/app/scripts/build-mic-capture.mjs` for the build step.
 *
 * The helper captures from the macOS **default input device**. Users who
 * want a specific mic should set it as the default in
 * System Settings → Sound → Input.
 */

type DiagnosticLogger = {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
};

export interface NativeMicSessionOptions {
  /** Absolute path to the `mic-capture` helper binary. */
  binaryPath: string;
  /** Where the WAV file gets written. Parent dir must exist. */
  outputPath: string;
  logger?: DiagnosticLogger;
  /** Fires the first time the helper reports `FIRST_SAMPLE` on stderr. */
  onFirstSample?: () => void;
}

export interface NativeMicSession {
  pid: number;
  outputPath: string;
  /** Wall-clock ms at first-sample arrival. Upgraded from the
   *  spawn-time seed when the helper's stderr `FIRST_SAMPLE` fires. */
  firstSampleAtMs: number;
  firstSampleSource: "mic-capture-first-sample" | "spawn-time";
  /** Wall-clock ms when stop() was called. */
  stoppedAtMs?: number;
  stop(): Promise<void>;
}

/**
 * Resolve the bundled `mic-capture` helper. In production the app passes
 * the path explicitly from `process.resourcesPath/bin/mic-capture`. In
 * tests and dev builds we check the dev tree:
 *   `<repo>/packages/app/resources/bin/mic-capture`
 * and env overrides.
 */
export function resolveNativeMicBinary(): string | null {
  if (process.platform !== "darwin") return null;
  const candidates = [
    process.env.MEETING_NOTES_MIC_CAPTURE_BINARY?.trim() || "",
    // dev tree layout (engine is at packages/engine; app helper at packages/app).
    path.resolve(
      process.cwd(),
      "../app/resources/bin/mic-capture"
    ),
    path.resolve(
      process.cwd(),
      "packages/app/resources/bin/mic-capture"
    ),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

export function startNativeMic(options: NativeMicSessionOptions): NativeMicSession {
  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });

  const spawnTimeMs = Date.now();
  const child: ChildProcess = spawn(options.binaryPath, [options.outputPath], {
    stdio: ["ignore", "ignore", "pipe"],
  });

  const session: NativeMicSession = {
    pid: child.pid ?? 0,
    outputPath: options.outputPath,
    firstSampleAtMs: spawnTimeMs,
    firstSampleSource: "spawn-time",
    stop: async () => {
      session.stoppedAtMs = Date.now();
      if (child.pid && !child.killed) {
        try {
          process.kill(child.pid, "SIGINT");
        } catch {
          // already exited
        }
      }
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.on("exit", () => resolve());
        setTimeout(() => {
          if (child.pid && !child.killed) {
            try {
              process.kill(child.pid, "SIGKILL");
            } catch {
              // ignore
            }
          }
          resolve();
        }, 5000);
      });
    },
  };

  // The helper prints `FIRST_SAMPLE` on stderr the first time its tap
  // callback fires. We use that as the first-sample wall-clock anchor:
  // the callback lag from hardware first-sample to this Date.now() is
  // ~one audio buffer (≈10 ms at 4096 samples @ 48 kHz), i.e. tight
  // enough to be below the drift-correction threshold.
  let stderrTail = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stderrTail = (stderrTail + text).slice(-4000);
    if (session.firstSampleSource !== "mic-capture-first-sample") {
      if (text.indexOf("FIRST_SAMPLE") !== -1) {
        session.firstSampleAtMs = Date.now();
        session.firstSampleSource = "mic-capture-first-sample";
        try {
          options.onFirstSample?.();
        } catch {
          // swallow hook errors
        }
      }
    }
  });

  child.on("exit", (code, signal) => {
    if (code !== 0 && code !== null && signal !== "SIGINT") {
      options.logger?.error("mic-capture exited with non-zero code", {
        exitCode: code,
        signal,
        stderrTail: stderrTail.slice(-2000),
      });
    }
  });

  return session;
}
