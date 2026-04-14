import { spawn, type ChildProcess } from "node:child_process";
import { AudioTee, type AudioChunk } from "audiotee";
import { pickPhysicalMic } from "@meeting-notes/engine";
import { broadcastToAll } from "./events.js";
import { isRecording } from "./recording.js";
import { resolveAudioTeeBinary } from "./audiotee-binary.js";

/**
 * Live audio-level monitor for the Settings → Audio tab. Spawns a lightweight
 * ffmpeg capture on the configured mic and an AudioTee tap on system audio,
 * computes peak + RMS levels every ~100 ms, and broadcasts them to any
 * renderer windows listening on `audio-monitor:levels`.
 *
 * Does **not** write audio to disk. Shuts down cleanly when stopped or when
 * a real recording starts (so the mic device is not double-opened).
 */

export interface AudioMonitorLevel {
  /** Peak amplitude in dBFS (-90..0). -Infinity is reported as -90. */
  peakDb: number;
  /** Root-mean-square in dBFS (-90..0). */
  rmsDb: number;
  /** Device name or label describing the source. */
  source: string;
  /** True if the capture pipeline started successfully. */
  active: boolean;
  /** Set when the capture pipeline failed to start (permission, missing device, etc). */
  error?: string;
}

export interface AudioMonitorSnapshot {
  mic: AudioMonitorLevel;
  system: AudioMonitorLevel;
}

export const AUDIO_MONITOR_EVENT = "audio-monitor:levels";
const EMIT_INTERVAL_MS = 100;
const FLOOR_DB = -90;

interface ChannelState {
  peakSq: number;
  sumSq: number;
  sampleCount: number;
  /** Bytes received since capture started — proves the data pipeline is live. */
  totalBytes: number;
  /** Samples whose value is exactly 0 since capture started. */
  zeroSampleCount: number;
  /** Running total of samples since capture started (vs sampleCount which is per emit window). */
  totalSamples: number;
  /** Timestamp when capture started, used to gate the permission warning. */
  startedAt: number;
  source: string;
  active: boolean;
  error?: string;
  /**
   * Kind of probable-permission-issue detected. AudioTee in particular will
   * happily deliver buffers of all-zero bytes when the macOS "System Audio
   * Recording" TCC permission isn't granted, instead of erroring out, so we
   * probe the data itself to diagnose that case.
   */
  permissionIssue?: "system-audio-tcc";
}

interface MonitorSession {
  stop: () => Promise<void>;
}

let activeSession: MonitorSession | null = null;

function silenceLevel(source: string, error?: string): AudioMonitorLevel {
  return {
    peakDb: FLOOR_DB,
    rmsDb: FLOOR_DB,
    source,
    active: false,
    error,
  };
}

function computeDb(maxSq: number, sumSq: number, count: number): { peakDb: number; rmsDb: number } {
  // 16-bit signed PCM: full-scale amplitude is 32767.
  const full = 32767;
  const peakAmp = Math.sqrt(maxSq);
  const rmsAmp = count > 0 ? Math.sqrt(sumSq / count) : 0;

  const toDb = (amp: number): number => {
    if (amp <= 0) return FLOOR_DB;
    const db = 20 * Math.log10(amp / full);
    return db < FLOOR_DB ? FLOOR_DB : db;
  };

  return { peakDb: toDb(peakAmp), rmsDb: toDb(rmsAmp) };
}

function accumulateS16LE(buf: Buffer, state: ChannelState): void {
  // Iterate 16-bit little-endian samples. Loop is hot — keep it tight.
  const len = buf.length - (buf.length % 2);
  state.totalBytes += len;
  for (let i = 0; i < len; i += 2) {
    // Signed 16-bit LE
    let s = buf[i] | (buf[i + 1] << 8);
    if (s & 0x8000) s |= ~0xffff;
    if (s === 0) state.zeroSampleCount += 1;
    state.totalSamples += 1;
    const sq = s * s;
    if (sq > state.peakSq) state.peakSq = sq;
    state.sumSq += sq;
    state.sampleCount += 1;
  }
}

/**
 * Decide whether a channel is "stuck at zero" — i.e., we've received enough
 * data that if the permission were granted we'd have seen at least some
 * natural noise floor. A real mic/system-audio tap is ~never 100% exact
 * zeros for several seconds (even ambient room tone has jitter).
 */
function hasPermissionIssue(state: ChannelState): boolean {
  const elapsedMs = Date.now() - state.startedAt;
  // Wait at least 1.5s before declaring; some taps take a moment to start.
  if (elapsedMs < 1500) return false;
  // Need a meaningful sample population.
  if (state.totalSamples < 8000) return false;
  // All bytes so far literally zero → permission missing / muted source.
  return state.zeroSampleCount === state.totalSamples;
}

function drainChannel(state: ChannelState): AudioMonitorLevel {
  if (!state.active) {
    return silenceLevel(state.source, state.error);
  }
  // Promote silent-zeros to a real error so the UI can surface a fix.
  if (!state.permissionIssue && hasPermissionIssue(state)) {
    state.permissionIssue = "system-audio-tcc";
    state.error =
      'No audio detected. Grant "System Audio Recording" permission in System Settings → Privacy & Security → Screen & System Audio Recording.';
  }
  const { peakDb, rmsDb } = computeDb(state.peakSq, state.sumSq, state.sampleCount);
  state.peakSq = 0;
  state.sumSq = 0;
  state.sampleCount = 0;
  return {
    peakDb,
    rmsDb,
    source: state.source,
    active: true,
    error: state.error,
  };
}

/**
 * Start the shared audio monitor. If one is already running, it is stopped
 * first so a new device selection takes effect immediately (Zoom-style live
 * source switching). If a real recording is in progress, start is a no-op
 * and reports the monitor as inactive — we don't want to compete for the
 * mic device.
 */
export async function startAudioMonitor(options: {
  micDevice: string;
  availableDevices: string[];
}): Promise<void> {
  if (activeSession) {
    const prior = activeSession;
    activeSession = null;
    try {
      await prior.stop();
    } catch {
      // best-effort
    }
  }
  if (isRecording()) {
    broadcastToAll(AUDIO_MONITOR_EVENT, {
      mic: silenceLevel("(paused — recording in progress)", "Monitor disabled while recording is active."),
      system: silenceLevel("(paused — recording in progress)"),
    } satisfies AudioMonitorSnapshot);
    return;
  }

  // Resolve mic device using the same logic as the recorder so the meter
  // reflects what a real recording would capture.
  let micDevice = options.micDevice;
  if (!micDevice || micDevice.trim() === "" || micDevice === "default") {
    micDevice = pickPhysicalMic(options.availableDevices);
  }

  const startedAt = Date.now();
  const micState: ChannelState = {
    peakSq: 0,
    sumSq: 0,
    sampleCount: 0,
    totalBytes: 0,
    zeroSampleCount: 0,
    totalSamples: 0,
    startedAt,
    source: micDevice || "(no microphone)",
    active: false,
  };
  const systemState: ChannelState = {
    peakSq: 0,
    sumSq: 0,
    sampleCount: 0,
    totalBytes: 0,
    zeroSampleCount: 0,
    totalSamples: 0,
    startedAt,
    source: "AudioTee (CoreAudio tap)",
    active: false,
  };

  // ---- Mic capture via ffmpeg → stdout raw PCM ----
  let micChild: ChildProcess | null = null;
  if (micDevice) {
    try {
      micChild = spawn(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel", "error",
          "-f", "avfoundation",
          "-i", `:${micDevice}`,
          "-ac", "1",
          "-ar", "16000",
          "-f", "s16le",
          "pipe:1",
        ],
        { stdio: ["ignore", "pipe", "pipe"] }
      );

      let stderrTail = "";
      micChild.stderr?.on("data", (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-500);
      });

      micChild.stdout?.on("data", (chunk: Buffer) => {
        accumulateS16LE(chunk, micState);
      });

      micChild.on("exit", (code, signal) => {
        if (code !== 0 && code !== null && signal !== "SIGINT" && signal !== "SIGTERM") {
          micState.active = false;
          micState.error = `ffmpeg exited with code ${code}: ${stderrTail.trim()}`;
        }
      });

      micChild.on("error", (err) => {
        micState.active = false;
        micState.error = err.message;
      });

      micState.active = true;
    } catch (err) {
      micState.active = false;
      micState.error = err instanceof Error ? err.message : String(err);
    }
  } else {
    micState.error = "No microphone available";
  }

  // ---- System capture via AudioTee ----
  let tee: AudioTee | null = null;
  try {
    const binaryPath = resolveAudioTeeBinary();
    tee = new AudioTee({ sampleRate: 16000, binaryPath });
    tee.on("data", (chunk: AudioChunk) => {
      if (chunk.data) accumulateS16LE(chunk.data, systemState);
    });
    tee.on("error", (err: Error) => {
      systemState.active = false;
      systemState.error = err.message;
    });
    await tee.start();
    systemState.active = true;
  } catch (err) {
    systemState.active = false;
    systemState.error =
      err instanceof Error
        ? `${err.message} — requires macOS 14.2+ and the System Audio Recording permission`
        : String(err);
  }

  // ---- Emit snapshots on a fixed cadence ----
  const emitTimer: NodeJS.Timeout = setInterval(() => {
    const snapshot: AudioMonitorSnapshot = {
      mic: drainChannel(micState),
      system: drainChannel(systemState),
    };
    broadcastToAll(AUDIO_MONITOR_EVENT, snapshot);
  }, EMIT_INTERVAL_MS);
  // Don't hold the event loop open just for a UI meter.
  emitTimer.unref?.();

  // Push an initial snapshot so the UI shows device labels / errors right away.
  broadcastToAll(AUDIO_MONITOR_EVENT, {
    mic: micState.active ? { peakDb: FLOOR_DB, rmsDb: FLOOR_DB, source: micState.source, active: true } : silenceLevel(micState.source, micState.error),
    system: systemState.active ? { peakDb: FLOOR_DB, rmsDb: FLOOR_DB, source: systemState.source, active: true } : silenceLevel(systemState.source, systemState.error),
  } satisfies AudioMonitorSnapshot);

  activeSession = {
    stop: async () => {
      clearInterval(emitTimer);

      if (micChild && micChild.pid && !micChild.killed) {
        try {
          process.kill(micChild.pid, "SIGINT");
        } catch {
          // already gone
        }
        // Give it a moment to clean up, then SIGKILL if needed.
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            if (micChild && micChild.pid && !micChild.killed) {
              try {
                process.kill(micChild.pid, "SIGKILL");
              } catch {
                // ignore
              }
            }
            resolve();
          }, 1000);
          micChild!.once("exit", () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }

      if (tee) {
        try {
          await tee.stop();
        } catch {
          // best-effort
        }
      }

      // Final "inactive" snapshot so the meter clears.
      broadcastToAll(AUDIO_MONITOR_EVENT, {
        mic: silenceLevel(micState.source),
        system: silenceLevel(systemState.source),
      } satisfies AudioMonitorSnapshot);
    },
  };
}

export async function stopAudioMonitor(): Promise<void> {
  const session = activeSession;
  activeSession = null;
  if (session) {
    await session.stop();
  }
}

export function isAudioMonitorRunning(): boolean {
  return activeSession !== null;
}
