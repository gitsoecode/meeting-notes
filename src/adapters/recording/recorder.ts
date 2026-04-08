export interface RecorderOptions {
  micDevice: string;
  systemDevice: string;
  outputDir: string;
}

export interface RecordingStopResult {
  micPath?: string;
  systemPath?: string;
  durationMs: number;
}

export interface RecordingSession {
  pids: number[];
  paths: { mic?: string; system?: string };
  systemCaptured: boolean;
  stop(): Promise<RecordingStopResult>;
}

export interface Recorder {
  start(options: RecorderOptions): Promise<RecordingSession>;
  isSystemCaptureAvailable(deviceName: string): Promise<boolean>;
  listAudioDevices(): Promise<string[]>;
}
