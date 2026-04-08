// Shared IPC types used by both the main process and the renderer.
// Keep this file dependency-free so it imports cleanly from both sides.

export interface RecordingStatus {
  active: boolean;
  run_id?: string;
  title?: string;
  started_at?: string;
  run_folder?: string;
  system_captured?: boolean;
}

export interface RunSummary {
  run_id: string;
  title: string;
  date: string;
  started: string;
  ended: string | null;
  status: string;
  source_mode: string;
  duration_minutes: number | null;
  tags: string[];
  folder_path: string;
  section_ids: string[];
}

export interface RunDetail extends RunSummary {
  manifest: unknown; // RunManifest from engine
  files: Array<{ name: string; path: string; size: number }>;
}

export interface PromptRow {
  id: string;
  label: string;
  filename: string;
  enabled: boolean;
  auto: boolean;
  builtin: boolean;
  source_path: string;
  body: string;
}

export interface StartRecordingRequest {
  title: string;
}

export interface ReprocessRequest {
  runFolder: string;
  onlyIds?: string[];
  onlyFailed?: boolean;
  skipComplete?: boolean;
  autoOnly?: boolean;
}

export interface BulkReprocessRequest {
  runFolders: string[];
  onlyIds?: string[];
}

export type PipelineProgressEvent =
  | {
      type: "section-start";
      runFolder: string;
      sectionId: string;
      label: string;
      filename: string;
    }
  | {
      type: "section-complete";
      runFolder: string;
      sectionId: string;
      label: string;
      filename: string;
      latencyMs: number;
      tokensUsed?: number;
    }
  | {
      type: "section-failed";
      runFolder: string;
      sectionId: string;
      label: string;
      filename: string;
      error: string;
      latencyMs: number;
    }
  | {
      type: "run-complete";
      runFolder: string;
      succeeded: string[];
      failed: string[];
    }
  | {
      type: "run-failed";
      runFolder: string;
      error: string;
    };

export interface AudioDevice {
  name: string;
}

export interface DepsCheckResult {
  ffmpeg: string | null;
  blackhole: boolean;
  python: string | null;
  /** Absolute path to the Parakeet binary if it's installed and executable, else null. */
  parakeet: string | null;
}

export interface AppConfigDTO {
  data_path: string;
  obsidian_integration: {
    enabled: boolean;
    vault_name?: string;
    vault_path?: string;
  };
  asr_provider: "whisper-local" | "openai" | "parakeet-mlx";
  llm_provider: "claude";
  whisper_local: {
    binary_path: string;
    model_path: string;
  };
  parakeet_mlx: {
    binary_path: string;
    model: string;
  };
  claude: {
    model: string;
  };
  recording: {
    mic_device: string;
    system_device: string;
  };
  shortcuts: {
    toggle_recording: string;
  };
}

export interface InitConfigRequest {
  data_path: string;
  obsidian_integration: {
    enabled: boolean;
    vault_name?: string;
    vault_path?: string;
  };
  asr_provider: AppConfigDTO["asr_provider"];
  recording: { mic_device: string; system_device: string };
  claude_api_key?: string;
  openai_api_key?: string;
}

/**
 * The API surface exposed to the renderer via contextBridge.
 * Keep this in sync with `preload/index.ts` and `main/ipc.ts`.
 */
export interface MeetingNotesApi {
  // Config
  config: {
    get: () => Promise<AppConfigDTO | null>;
    save: (config: AppConfigDTO) => Promise<void>;
    initProject: (req: InitConfigRequest) => Promise<void>;
    setDataPath: (newPath: string) => Promise<{ from: string; to: string }>;
    setObsidianEnabled: (enabled: boolean) => Promise<void>;
    setObsidianVault: (vaultPath: string) => Promise<void>;
    openInFinder: (path: string) => Promise<void>;
    pickDirectory: (opts?: { defaultPath?: string }) => Promise<string | null>;
    pickAudioFile: () => Promise<string | null>;
  };
  // Recording
  recording: {
    getStatus: () => Promise<RecordingStatus>;
    start: (req: StartRecordingRequest) => Promise<{ run_folder: string; run_id: string }>;
    stop: () => Promise<{ run_folder: string } | null>;
    listAudioDevices: () => Promise<AudioDevice[]>;
  };
  // Runs
  runs: {
    list: () => Promise<RunSummary[]>;
    get: (runFolder: string) => Promise<RunDetail>;
    readFile: (filePath: string) => Promise<string>;
    writeFile: (filePath: string, content: string) => Promise<void>;
    reprocess: (req: ReprocessRequest) => Promise<void>;
    bulkReprocess: (req: BulkReprocessRequest) => Promise<void>;
    processAudio: (audioPath: string, title: string) => Promise<{ run_folder: string }>;
    openInObsidian: (filePath: string) => Promise<void>;
    openInFinder: (runFolder: string) => Promise<void>;
    deleteRun: (runFolder: string) => Promise<void>;
  };
  // Prompts
  prompts: {
    list: () => Promise<PromptRow[]>;
    save: (id: string, body: string, patch: Partial<PromptRow>) => Promise<void>;
    create: (id: string, label: string, filename: string, body: string) => Promise<void>;
    enable: (id: string, enabled: boolean) => Promise<void>;
    setAuto: (id: string, auto: boolean) => Promise<void>;
    resetToDefault: (id?: string) => Promise<void>;
    getDir: () => Promise<string>;
    openInFinder: () => Promise<void>;
  };
  // Secrets
  secrets: {
    has: (name: "claude" | "openai") => Promise<boolean>;
    set: (name: "claude" | "openai", value: string) => Promise<void>;
  };
  // ASR setup
  setupAsr: (opts: { force?: boolean }) => Promise<void>;
  // Logs
  logs: {
    tailApp: (lines: number) => Promise<string>;
    tailRun: (runFolder: string, lines: number) => Promise<string>;
    appPath: () => Promise<string>;
  };
  // Deps check
  depsCheck: () => Promise<DepsCheckResult>;
  // Events (subscribe)
  on: {
    recordingStatus: (cb: (status: RecordingStatus) => void) => () => void;
    pipelineProgress: (cb: (event: PipelineProgressEvent) => void) => () => void;
    setupAsrLog: (cb: (line: string) => void) => () => void;
    shortcutTriggered: (cb: () => void) => () => void;
  };
}

declare global {
  interface Window {
    api: MeetingNotesApi;
  }
}
