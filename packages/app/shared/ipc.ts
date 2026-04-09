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
  description: string | null;
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
  files: Array<{ name: string; size: number }>;
}

export interface PromptRow {
  id: string;
  label: string;
  filename: string;
  enabled: boolean;
  auto: boolean;
  builtin: boolean;
  /** Per-prompt model override; null falls back to config.claude.model. */
  model: string | null;
  source_path: string;
  body: string;
}

export interface StartRecordingRequest {
  title: string;
  description?: string | null;
}

export interface UpdateMetaRequest {
  runFolder: string;
  title?: string;
  description?: string | null;
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

export interface ReprocessResult {
  runFolder: string;
  succeeded: string[];
  failed: string[];
}

export interface BulkReprocessResult extends ReprocessResult {
  error?: string;
}

export type PipelineProgressEvent =
  | {
      type: "section-start";
      runFolder: string;
      sectionId: string;
      label: string;
      filename: string;
      /** Model id this section will run against; lets the UI label local vs cloud. */
      model?: string;
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

/**
 * Tri-state for BlackHole detection. macOS sometimes has the HAL driver
 * file on disk but `coreaudiod` hasn't picked it up yet (common right
 * after `brew install --cask blackhole-2ch`), so a single boolean isn't
 * enough — we need to distinguish "missing" from "installed but not
 * loaded" so the wizard can offer a restart-audio recovery instead of
 * just saying "not installed".
 */
export type BlackHoleStatus = "missing" | "installed-not-loaded" | "loaded";

export interface DepsCheckResult {
  ffmpeg: string | null;
  blackhole: BlackHoleStatus;
  python: string | null;
  /** Absolute path to the Parakeet binary if it's installed and executable, else null. */
  parakeet: string | null;
  /**
   * Local-LLM (Ollama) status. The daemon is owned by the main process; we
   * always have a binary (bundled or system), so the only useful question
   * the renderer needs to ask is "is it answering?" plus the list of
   * already-installed models so we can avoid duplicate downloads.
   */
  ollama: {
    daemon: boolean;
    source?: "system-running" | "system-spawned" | "bundled-spawned";
    installedModels: string[];
  };
}

export interface HardwareInfoDTO {
  arch: string;
  platform: string;
  totalRamGb: number;
  chip?: string;
  appleSilicon: boolean;
}

/**
 * Dependencies the Setup Wizard can install via Homebrew on the user's
 * behalf. Keep this union in sync with the `deps:install` handler in
 * `main/ipc.ts` — adding a new target requires both sides to agree.
 */
export type DepsInstallTarget = "ffmpeg" | "blackhole";

export interface DepsInstallResult {
  ok: boolean;
  /** Set when brew is missing from PATH — renderer shows a targeted fallback. */
  brewMissing?: boolean;
  /** Error message from the brew process if !ok. */
  error?: string;
}

export interface DetectedVault {
  path: string;
  name: string;
}

export interface AppConfigDTO {
  data_path: string;
  obsidian_integration: {
    enabled: boolean;
    vault_name?: string;
    vault_path?: string;
  };
  asr_provider: "whisper-local" | "openai" | "parakeet-mlx";
  llm_provider: "claude" | "ollama";
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
  ollama: {
    base_url: string;
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
  /** Defaults to "claude". When "ollama", we won't require an Anthropic key. */
  llm_provider?: AppConfigDTO["llm_provider"];
  /** Required when llm_provider === "ollama". Ollama tag (e.g. "qwen2.5:7b"). */
  ollama_model?: string;
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
    openDataDirectory: () => Promise<void>;
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
    readDocument: (runFolder: string, fileName: string) => Promise<string>;
    writeNotes: (runFolder: string, content: string) => Promise<void>;
    reprocess: (req: ReprocessRequest) => Promise<ReprocessResult>;
    bulkReprocess: (req: BulkReprocessRequest) => Promise<BulkReprocessResult[]>;
    processAudio: (audioPath: string, title: string) => Promise<{ run_folder: string }>;
    openInObsidian: (runFolder: string, fileName: string) => Promise<void>;
    openInFinder: (runFolder: string) => Promise<void>;
    deleteRun: (runFolder: string) => Promise<void>;
    updateMeta: (req: UpdateMetaRequest) => Promise<void>;
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
  // Local LLM (Ollama)
  llm: {
    /** Ensure the Ollama daemon is running and report installed models. */
    check: () => Promise<DepsCheckResult["ollama"]>;
    /** Pull a model and stream progress via setup-llm:log. */
    setup: (opts: { model: string; force?: boolean }) => Promise<void>;
    /** List installed model tags. */
    listInstalled: () => Promise<string[]>;
    /** Delete an installed model. */
    remove: (model: string) => Promise<void>;
  };
  system: {
    detectHardware: () => Promise<HardwareInfoDTO>;
  };
  // Logs
  logs: {
    tailApp: (lines: number) => Promise<string>;
    tailRun: (runFolder: string, lines: number) => Promise<string>;
    appPath: () => Promise<string>;
  };
  // Deps check
  depsCheck: () => Promise<DepsCheckResult>;
  // Dependency install (Homebrew wrapper)
  deps: {
    install: (target: DepsInstallTarget) => Promise<DepsInstallResult>;
    checkBrew: () => Promise<boolean>;
    /** Restart macOS coreaudiod via osascript. Triggers a sudo dialog. */
    restartAudio: () => Promise<{ ok: boolean; error?: string }>;
  };
  // Obsidian vault detection (scans ~/Obsidian and ~/Documents)
  obsidian: {
    detectVaults: () => Promise<DetectedVault[]>;
  };
  // Events (subscribe)
  on: {
    recordingStatus: (cb: (status: RecordingStatus) => void) => () => void;
    pipelineProgress: (cb: (event: PipelineProgressEvent) => void) => () => void;
    setupAsrLog: (cb: (line: string) => void) => () => void;
    setupLlmLog: (cb: (line: string) => void) => () => void;
    depsInstallLog: (cb: (line: string) => void) => () => void;
    shortcutTriggered: (cb: () => void) => () => void;
  };
}

declare global {
  interface Window {
    api: MeetingNotesApi;
  }
}
