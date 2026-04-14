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
}

export interface RecordingStopResult {
  micPath?: string;
  systemPath?: string;
  durationMs: number;
}

/**
 * Wall-clock timestamps captured just before each capture pipeline hands off
 * to its underlying producer (ffmpeg for the mic, AudioTee for system audio).
 * Used by the engine's AEC step as a coarse offset hint so cross-correlation
 * doesn't have to search the full acceptable range.
 */
export interface CaptureMeta {
  micStartedAtMs?: number;
  systemStartedAtMs?: number;
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
