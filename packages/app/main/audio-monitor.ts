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
  /**
   * Swap the mic source without tearing down the AudioTee capture. Avoids
   * a full monitor restart (which briefly surfaces the system-audio channel
   * as "no signal" while AudioTee respawns) when the only thing the user
   * changed is the mic dropdown.
   */
  switchMic: (micDevice: string) => Promise<void>;
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

function drainChannel(state: ChannelState): AudioMonitorLevel {
  if (!state.active) {
    return silenceLevel(state.source, state.error);
  }
  // We intentionally no longer infer a permission issue from the
  // all-zero-samples signal here. Bluetooth route changes and output-device
  // switches briefly produce runs of exact zeros that used to trip the
  // heuristic and surface a false "System Audio Recording permission needed"
  // banner. Authoritative permission status comes from the OS probe exposed
  // via `system:get-audio-permissions`, and a user-initiated "Diagnose audio"
  // dialog re-uses `recording:test-audio` for a deliberate signal check.
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
  // `micChildRef.current` lets us swap the ffmpeg child without rebuilding
  // the whole session, so switching mic dropdowns doesn't blip the system
  // audio meter through an AudioTee restart.
  const micChildRef: { current: ChildProcess | null } = { current: null };
  const spawnMicChild = (device: string): void => {
    try {
      const child = spawn(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel", "error",
          "-f", "avfoundation",
          "-i", `:${device}`,
          "-ac", "1",
          "-ar", "16000",
          "-f", "s16le",
          "pipe:1",
        ],
        { stdio: ["ignore", "pipe", "pipe"] }
      );

      let stderrTail = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-500);
      });

      child.stdout?.on("data", (chunk: Buffer) => {
        accumulateS16LE(chunk, micState);
      });

      child.on("exit", (code, signal) => {
        if (code !== 0 && code !== null && signal !== "SIGINT" && signal !== "SIGTERM") {
          if (micChildRef.current === child) {
            micState.active = false;
            micState.error = `ffmpeg exited with code ${code}: ${stderrTail.trim()}`;
          }
        }
      });

      child.on("error", (err) => {
        if (micChildRef.current === child) {
          micState.active = false;
          micState.error = err.message;
        }
      });

      micChildRef.current = child;
      micState.active = true;
      micState.error = undefined;
      micState.source = device;
    } catch (err) {
      micState.active = false;
      micState.error = err instanceof Error ? err.message : String(err);
    }
  };
  const killMicChild = async (): Promise<void> => {
    const child = micChildRef.current;
    micChildRef.current = null;
    if (!child || !child.pid || child.killed) return;
    try {
      process.kill(child.pid, "SIGINT");
    } catch {
      // already gone
    }
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (child.pid && !child.killed) {
          try {
            process.kill(child.pid, "SIGKILL");
          } catch {
            // ignore
          }
        }
        resolve();
      }, 1000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  };
  if (micDevice) {
    spawnMicChild(micDevice);
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

      await killMicChild();

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
    switchMic: async (nextDevice: string) => {
      // Resolve "default" the same way the initial start did.
      let resolved = nextDevice;
      if (!resolved || resolved.trim() === "" || resolved === "default") {
        resolved = pickPhysicalMic(options.availableDevices);
      }
      if (resolved === micState.source && micChildRef.current && !micChildRef.current.killed) {
        return;
      }
      await killMicChild();
      // Reset per-channel accumulators so stale counts from the previous
      // device don't bleed into the new one.
      micState.peakSq = 0;
      micState.sumSq = 0;
      micState.sampleCount = 0;
      micState.totalBytes = 0;
      micState.zeroSampleCount = 0;
      micState.totalSamples = 0;
      micState.startedAt = Date.now();
      if (resolved) {
        spawnMicChild(resolved);
      } else {
        micState.active = false;
        micState.error = "No microphone available";
        micState.source = "(no microphone)";
      }
    },
  };
}

/**
 * Swap the mic source on the active monitor without tearing down AudioTee.
 * Returns `true` if a live session handled the swap, `false` if there was no
 * active monitor (caller should fall back to a fresh start).
 */
export async function switchMonitorMic(micDevice: string): Promise<boolean> {
  if (!activeSession) return false;
  await activeSession.switchMic(micDevice);
  return true;
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
