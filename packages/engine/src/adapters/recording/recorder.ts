export interface RecorderOptions {
  micDevice: string;
  systemDevice: string;
  outputDir: string;
  /** Pre-enumerated device list to skip ffmpeg device-listing spawns. */
  devices?: string[];
  /**
   * Absolute path to a patched audiotee binary that inherits the parent
   * process's TCC responsibility. Without this, AudioTee runs the stock
   * helper from node_modules, which macOS treats as its own app and which
   * silently records zeros in development. See
   * `packages/app/main/audiotee-binary.ts` for how the Electron app resolves
   * this, and `packages/app/scripts/patch-audiotee.mjs` for how the patched
   * binary gets produced.
   */
  audioTeeBinaryPath?: string;
  /**
   * Absolute path to the bundled `mic-capture` helper binary. When
   * provided, a native CoreAudio capture path is used instead of
   * ffmpeg's AVFoundation demuxer (which drops ~10–12 % of samples on
   * USB microphones under macOS 14+). If omitted, the engine tries to
   * auto-resolve the helper from the dev tree; when nothing is found,
   * it falls back to ffmpeg AVFoundation (degraded mode).
   */
  micCaptureBinaryPath?: string;
  /**
   * When true (default if omitted), enables Apple's voice processing
   * (AEC + AGC + noise suppression) on the native mic-capture helper.
   * Only consumed by the native CoreAudio path; the ffmpeg fallback
   * ignores this flag.
   */
  voiceProcessingEnabled?: boolean;
}

export interface RecordingStopResult {
  micPath?: string;
  systemPath?: string;
  durationMs: number;
}

/**
 * Quality label for a per-stream first-sample wall-clock anchor.
 * - `first-chunk` (system) / `stderr-time` (mic): trustworthy — the timestamp
 *   tracks the real first-sample arrival.
 * - `tee-start` (system) / `spawn-time` (mic): degraded — captured before
 *   first sample was known to have arrived.
 */
export type MicStartSource =
  | "mic-capture-first-sample"
  | "stderr-time"
  | "spawn-time";
export type SystemStartSource = "first-chunk" | "tee-start";

export interface StreamCaptureMeta {
  /** Wall-clock ms at (approximate) first-sample arrival. */
  firstSampleAtMs?: number;
  /** Which mechanism produced `firstSampleAtMs`. */
  firstSampleSource?: MicStartSource | SystemStartSource;
  /** Wall-clock ms when this stream's capture was stopped. */
  stoppedAtMs?: number;
  /** `stoppedAtMs − durationMs`; independent first-sample estimate. */
  endAnchorAtMs?: number;
  /** Final file duration in ms (from ffprobe / known sample count). */
  durationMs?: number;
}

/**
 * Wall-clock timing metadata for mic and system streams. Used by the
 * engine's alignment step as a trustworthy primary offset hint — the
 * cross-correlation search is reduced to a bounded refinement around this
 * anchor rather than the primary source of truth.
 *
 * Legacy `micStartedAtMs` / `systemStartedAtMs` are kept populated for
 * backward compatibility with older run folders.
 */
export interface CaptureMeta {
  micStartedAtMs?: number;
  systemStartedAtMs?: number;
  mic?: StreamCaptureMeta;
  system?: StreamCaptureMeta;
}

export interface RecordingSession {
  pids: number[];
  paths: { mic?: string; system?: string };
  systemCaptured: boolean;
  /** Optional metadata about when each capture stream started, for downstream AEC. */
  captureMeta?: CaptureMeta;
  stop(): Promise<RecordingStopResult>;
}

export interface Recorder {
  start(options: RecorderOptions): Promise<RecordingSession>;
  isSystemCaptureAvailable(deviceName: string): Promise<boolean>;
  listAudioDevices(): Promise<string[]>;
}
