// Shared IPC types used by both the main process and the renderer.
// Keep this file dependency-free so it imports cleanly from both sides.

export interface RecordingStatus {
  active: boolean;
  paused?: boolean;
  run_id?: string;
  title?: string;
  started_at?: string;
  run_folder?: string;
  system_captured?: boolean;
  /** Set when system audio capture failed or is silent — shown as a visible warning. */
  system_audio_warning?: string;
}

export type AppActionEvent =
  | { type: "open-new-meeting"; source: "shortcut" | "tray" }
  | { type: "toggle-recording"; source: "shortcut" | "tray" }
  | {
      /**
       * Fired by the main process when the app is activated via a
       * `gistlist://meeting/<run_id>?...` deep link — typically a user
       * clicking a citation from Claude Desktop. Routed through the
       * renderer's `handleOpenMeetingFromDeepLink` helper.
       */
      type: "open-meeting";
      source: "deep-link";
      runId: string;
      startMs: number | null;
      /** The section of the meeting the external citation pointed at. */
      citationSource: "transcript" | "summary" | "prep" | "notes" | null;
    };

export type AppLogLevel = "debug" | "info" | "warn" | "error";

export interface AppLogEntry {
  id: string;
  timestamp: string;
  level: AppLogLevel;
  component: string;
  message: string;
  data?: Record<string, unknown>;
  jobId?: string;
  runFolder?: string;
  processType?: string;
  pid?: number;
  stack?: string;
  detail?: string;
}

export interface AppLogQuery {
  limit?: number;
}

export interface ActivityProcess {
  id: string;
  type: string;
  label: string;
  status: "starting" | "running" | "exited" | "failed";
  pid?: number;
  command?: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
  signal?: string | null;
  jobId?: string;
  runFolder?: string;
  error?: string;
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
  prompt_output_ids: string[];
  scheduled_time?: string | null;
  updated_at: string | null;
  folder_size_bytes: number | null;
}

export interface RunPromptOutputState {
  status: "pending" | "running" | "complete" | "failed";
  filename: string;
  label?: string;
  error?: string;
  model?: string;
}

export interface RunManifest {
  run_id: string;
  title: string;
  status: string;
  prompt_outputs: Record<string, RunPromptOutputState>;
}

export interface RunDetail extends RunSummary {
  manifest: RunManifest;
  files: Array<{ name: string; size: number; kind: "document" | "log" | "media" | "attachment" }>;
  audioStorage?: AudioStorageSummary;
}

export interface AudioStorageSummary {
  mode: "compact" | "lossless" | "full-fidelity" | "mixed" | "none";
  sourceFormat: "ogg" | "flac" | "wav" | "mixed" | "none";
  combinedFormat: "ogg" | "wav" | "none";
  totalBytes: number;
  usesLossySources: boolean;
}

export interface DownloadMediaResult {
  canceled: boolean;
}

export interface PromptRow {
  id: string;
  label: string;
  description: string | null;
  sort_order: number | null;
  filename: string;
  enabled: boolean;
  auto: boolean;
  builtin: boolean;
  /** Per-prompt model override; null falls back to config.claude.model. */
  model: string | null;
  /** Per-prompt temperature override; null falls back to provider default (0.3). */
  temperature: number | null;
  source_path: string;
  body: string;
}

export interface StartRecordingRequest {
  title: string;
  description?: string | null;
}

export interface StopRecordingRequest {
  mode?: "process" | "save" | "delete";
}

export interface StopRecordingResult {
  run_folder?: string;
  deleted?: boolean;
}

export interface CreateDraftRequest {
  title: string;
  description?: string | null;
  scheduledTime?: string | null;
}

export interface CreateDraftResult {
  run_folder: string;
  run_id: string;
}

export interface AddAttachmentResult {
  fileName: string;
  size: number;
}

export interface StartRecordingForDraftRequest {
  runFolder: string;
}

export interface UpdatePrepRequest {
  runFolder: string;
  selectedPrompts?: string[] | null;
  scheduledTime?: string | null;
}

export interface ContinueRecordingRequest {
  runFolder: string;
}

export interface ProcessRecordingRequest {
  runFolder: string;
  onlyIds?: string[];
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

export interface PipelinePlannedStep {
  promptOutputId: string;
  label: string;
  filename: string;
  model?: string;
  kind: "transcript" | "prompt";
}

export type PipelineProgressEvent =
  | {
      type: "run-planned";
      runFolder: string;
      steps: PipelinePlannedStep[];
    }
  | {
      type: "output-start";
      runFolder: string;
      promptOutputId: string;
      label: string;
      filename: string;
      /** Model id this output will run against; lets the UI label local vs cloud. */
      model?: string;
    }
  | {
      type: "output-complete";
      runFolder: string;
      promptOutputId: string;
      label: string;
      filename: string;
      latencyMs: number;
      tokensUsed?: number;
    }
  | {
      type: "output-failed";
      runFolder: string;
      promptOutputId: string;
      label: string;
      filename: string;
      error: string;
      latencyMs: number;
    }
  | {
      type: "output-progress";
      runFolder: string;
      promptOutputId: string;
      tokensGenerated: number;
      charsGenerated: number;
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

export type JobKind =
  | "process-recording"
  | "process-import"
  | "reprocess-run"
  | "run-prompt";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export type JobStepState = "queued" | "running" | "complete" | "failed";

export interface JobProgressStep extends PipelinePlannedStep {
  state: JobStepState;
  latencyMs?: number;
  tokensGenerated?: number;
  error?: string;
  startedAt?: number;
}

export interface JobProgress {
  completedOutputs: number;
  failedOutputs: number;
  totalOutputs: number;
  currentOutputLabel?: string;
  steps: JobProgressStep[];
}

export interface JobSummary {
  id: string;
  kind: JobKind;
  status: JobStatus;
  title: string;
  subtitle: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  cancelable: boolean;
  queuePosition?: number;
  runFolder?: string;
  promptIds?: string[];
  provider?: string;
  model?: string;
  progress: JobProgress;
  error?: string;
}

export interface OllamaRuntimeModelDTO {
  model: string;
  name?: string;
  size?: number;
  size_vram?: number;
  expires_at?: string;
  details?: {
    parameter_size?: string;
    quantization_level?: string;
    family?: string;
    format?: string;
  };
}

export interface OllamaRuntimeDTO {
  available: boolean;
  source?: "system-running" | "system-spawned" | "bundled-spawned";
  models: OllamaRuntimeModelDTO[];
  error?: string;
  systemMemory?: {
    totalBytes: number;
    freeBytes: number;
    ollamaVramBytes: number;
  };
}

export interface AudioDevice {
  name: string;
}

/**
 * A single channel snapshot from the live audio-level monitor used in
 * Settings → Audio. Values are in dBFS (full-scale digital), where 0 dB
 * is the loudest possible signal and -90 dB is effective silence.
 */
export interface AudioMonitorLevel {
  peakDb: number;
  rmsDb: number;
  source: string;
  active: boolean;
  error?: string;
}

export interface AudioMonitorSnapshot {
  mic: AudioMonitorLevel;
  system: AudioMonitorLevel;
}

/** One channel of {@link AudioTestReport}. */
export interface AudioTestChannelResult {
  deviceName: string;
  role: "mic" | "system";
  found: boolean;
  recorded: boolean;
  fileSizeBytes: number;
  durationSeconds: number;
  meanVolumeDb: number;
  maxVolumeDb: number;
  isSilent: boolean;
  error?: string;
}

/** Return value of `api.recording.testAudio()`. */
export interface AudioTestReport {
  devices: string[];
  micDevice: string;
  systemDevice: string;
  results: AudioTestChannelResult[];
}

/** @deprecated BlackHole is no longer required — system audio is captured via AudioTee. */
export type BlackHoleStatus = "missing" | "installed-not-loaded" | "loaded";

/**
 * One row of `DepsCheckResult` for tools the resolver can find in
 * multiple places. The renderer uses `source` to render badges
 * ("App copy" / "System: …") and to offer a "Use a clean copy"
 * affordance when a system-resolved binary is in use but a clean
 * wizard install would be safer.
 *
 * `null` source means the binary wasn't found anywhere — `path` is
 * also null in that case. `version` is best-effort: the resolver
 * tries to parse `--version` output for tools where it makes sense,
 * and returns null when parsing fails (which is non-fatal).
 */
export interface ResolvedTool {
  path: string | null;
  source: "app-installed" | "bundled" | "system" | null;
  version: string | null;
}

export interface DepsCheckResult {
  /** ffmpeg via wizard install, bundle, or system PATH. */
  ffmpeg: ResolvedTool;
  /**
   * ffprobe — installed as a paired follow-up to ffmpeg by the wizard
   * (see manifest.ts). The renderer's System Health row labels the
   * combined "ffmpeg" status and renders this field's path inline so
   * users can tell a half-installed state ("ffmpeg present · ffprobe
   * missing") apart from a fully-resolved one.
   */
  ffprobe: ResolvedTool;
  /** @deprecated Kept for type compatibility. Always "missing" in new code. */
  blackhole: BlackHoleStatus;
  /** True when macOS 14.2+ supports automatic system audio capture via CoreAudio taps. */
  systemAudioSupported: boolean;
  /** python3 — system-only (we never install python ourselves). */
  python: ResolvedTool;
  /** Parakeet venv binary — app-managed, lives under ~/.gistlist/. */
  parakeet: ResolvedTool;
  /**
   * whisper-cli — system PATH only. whisper.cpp v1.8.4 ships no signed
   * macOS CLI, so the wizard installer manifest intentionally has no
   * whisper-cli entry. The row is rendered as optional/neutral in
   * Settings unless the user explicitly picks whisper-local as their
   * ASR provider.
   */
  whisper: ResolvedTool;
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
    version?: string | null;
  };
}

/**
 * Phase the wizard installer is in. Surfaced via `installer-progress`
 * so the UI can label the current step ("Downloading…",
 * "Verifying signature…", etc.) and on failure show which phase failed.
 */
export type InstallerPhase =
  | "download"
  | "verify-checksum"
  | "extract"
  | "verify-signature"
  | "verify-exec"
  | "complete"
  | "failed";

export interface InstallerProgressEvent {
  tool: "ffmpeg" | "ollama" | "whisper-cli" | string;
  phase: InstallerPhase;
  bytesDone?: number;
  bytesTotal?: number;
  /** Set on phase: "failed". A short message suitable for the UI. */
  error?: string;
}

// ---- electron-updater wiring ----------------------------------------------

export type UpdaterStatusKind =
  | "disabled-at-build"
  | "idle"
  | "checking"
  | "no-update"
  | "available"
  | "downloading"
  | "downloaded"
  | "deferred-recording"
  | "error";

export interface UpdaterStatus {
  enabled: boolean;
  kind: UpdaterStatusKind;
  /** Set when an update is announced or downloaded. */
  version?: string;
  bytesPerSecond?: number;
  bytesDone?: number;
  bytesTotal?: number;
  /** ISO timestamp of the last `checkForUpdates` call. */
  lastChecked?: string;
  /** Set on kind === "error". */
  error?: string;
  /** GitHub release notes URL when available. */
  releaseNotesUrl?: string;
}

export interface UpdaterPreferences {
  autoCheck: boolean;
  notifyBanner: boolean;
}

/** Dev-only simulator dispatch payload. Production builds reject these. */
export type UpdaterSimulatorAction =
  | "available-and-prompt"
  | "download-start"
  | "install-attempt"
  | "error"
  | "reset";

export interface HardwareInfoDTO {
  arch: string;
  platform: string;
  totalRamGb: number;
  chip?: string;
  appleSilicon: boolean;
}

/**
 * Dependencies the Setup Wizard installs directly (no Homebrew). Targets
 * map 1:1 to `ToolName` in `main/installers/manifest.ts` — adding a new
 * tool means adding a manifest entry AND extending this union.
 */
export type DepsInstallTarget = "ffmpeg" | "ollama" | "whisper-cli";

export interface DepsInstallResult {
  ok: boolean;
  /**
   * @deprecated Brew is no longer the install mechanism. Kept for
   * type-shape compatibility during the Phase 2/3 transition; always
   * undefined in new code paths.
   */
  brewMissing?: boolean;
  /** Error message from the install pipeline if !ok. */
  error?: string;
  /**
   * Phase that failed (download / verify-checksum / extract /
   * verify-signature / verify-exec / manifest). Renderer maps this
   * to a specific Retry-state message.
   */
  failedPhase?: string;
}

export interface DetectedVault {
  path: string;
  name: string;
}

export interface PickedMediaFile {
  token: string;
  name: string;
}

// ---- Meeting index (FTS + sqlite-vec corpus the MCP server reads) ----

export type MeetingIndexBackfillScope = "missing-chunks" | "missing-embeddings";

export interface MeetingIndexProgressDTO {
  state: "idle" | "running" | "paused" | "complete" | "error";
  total: number;
  completed: number;
  currentRunFolder: string | null;
  errors: number;
  /**
   * Which run set this progress reflects. Lets the renderer attribute
   * `errors` correctly when Settings opens after the run already finished
   * (e.g. distinguishing "Ollama unreachable" from "indexing failed").
   */
  scope: MeetingIndexBackfillScope;
}

export interface MeetingIndexHealthDTO {
  /** Total runs in a terminal state (`complete` or `error`). */
  totalRuns: number;
  /** Terminal runs with zero `chat_chunks` rows. */
  pendingRuns: number;
  /**
   * Distinct terminal runs with at least one chunk missing its vec row
   * (FTS-only because the embedder failed). Always 0 when sqlite-vec
   * isn't loaded.
   */
  ftsOnlyRuns: number;
  /** Whether the sqlite-vec extension is currently loaded. */
  vecAvailable: boolean;
}

// ---- Chat Launcher ----

export type ChatAppId = "chatgpt" | "claude" | "ollama" | "custom";

export interface ChatAppInfo {
  id: ChatAppId;
  label: string;
  installed: boolean;
}

export interface LaunchChatRequest {
  appId: ChatAppId;
  customAppName?: string;
  runFolder: string;
  fileNames: string[];
  startingPrompt: string;
}

export interface LaunchChatResult {
  ok: boolean;
  error?: string;
  charsCopied?: number;
}

export interface AppConfigDTO {
  data_path: string;
  obsidian_integration: {
    enabled: boolean;
    vault_name?: string;
    vault_path?: string;
  };
  asr_provider: "whisper-local" | "openai" | "parakeet-mlx";
  llm_provider: "claude" | "openai" | "ollama";
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
  openai: {
    model: string;
  };
  ollama: {
    base_url: string;
    model: string;
  };
  recording: {
    mic_device: string;
    system_device: string;
    /**
     * When true (default), enables Apple's voice processing
     * (AEC + AGC + noise suppression) on the native mic-capture helper.
     * Cancels speaker bleed when recording with built-in speakers.
     */
    voice_processing_enabled?: boolean;
  };
  shortcuts: {
    toggle_recording: string;
  };
  chat_launcher?: {
    default_prompt: string;
    draft_prompt?: string;
    recording_prompt?: string;
  };
  audio_retention_days: number | null;
  audio_storage_mode: "compact" | "lossless" | "full-fidelity";
}

export interface InitConfigRequest {
  data_path: string;
  obsidian_integration: {
    enabled: boolean;
    vault_name?: string;
    vault_path?: string;
  };
  asr_provider: AppConfigDTO["asr_provider"];
  /** Defaults to "claude". */
  llm_provider?: AppConfigDTO["llm_provider"];
  /** Required when llm_provider === "ollama". Ollama tag (e.g. "qwen2.5:7b"). */
  ollama_model?: string;
  recording: { mic_device: string; system_device: string };
  claude_api_key?: string;
  openai_api_key?: string;
  /**
   * Required (not optional). The wizard's retention step is always shown,
   * so this field is always collected. Making it required at the type
   * level means the IPC handler can use it authoritatively without an
   * `??` fallback that would silently swallow a "user chose Never"
   * (`null`) intent.
   */
  audio_retention_days: number | null;
  audio_storage_mode?: AppConfigDTO["audio_storage_mode"];
}

/**
 * The API surface exposed to the renderer via contextBridge.
 * Keep this in sync with `preload/index.ts` and `main/ipc.ts`.
 */
export interface McpIntegrationStatus {
  /** Path to the bundled MCP server entrypoint (for diagnostics / install row). */
  serverJsPath: string;
  serverJsExists: boolean;
  /** True when `mcpServers.gistlist` is present in Claude Desktop's config. */
  configInstalled: boolean;
  /** Surfaced to the UI when the config file is unreadable/malformed. */
  configReadError: string | null;
  /** Absolute path to Claude Desktop's config file (for error messages / docs). */
  claudeConfigPath: string;
  /** Best-effort check for whether Claude Desktop is installed at all. */
  claudeDesktopInstalled: "yes" | "no" | "unknown";
  /** Count of meetings in meetings.db; null when the DB hasn't been created yet. */
  meetingsIndexed: number | null;
  /** Live Ollama check — affects whether semantic search will work from the MCP server. */
  ollamaRunning: boolean;
}

export interface McpInstallResult {
  ok: boolean;
  /** True when an existing entry was overwritten / removed (vs. first-time add). */
  updated?: boolean;
  /** True when a legacy `.mcpb` install was cleaned up as part of the flow. */
  legacyRemoved?: boolean;
  /** Set on failure — surfaces to the UI toast. */
  error?: string;
}

export interface GistlistApi {
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
    pickMediaFile: () => Promise<PickedMediaFile | null>;
  };
  // Recording
  recording: {
    getStatus: () => Promise<RecordingStatus>;
    start: (req: StartRecordingRequest) => Promise<{ run_folder: string; run_id: string }>;
    stop: (req?: StopRecordingRequest) => Promise<StopRecordingResult | null>;
    startForDraft: (req: StartRecordingForDraftRequest) => Promise<{ run_folder: string; run_id: string }>;
    pause: () => Promise<void>;
    resume: () => Promise<void>;
    continueRecording: (req: ContinueRecordingRequest) => Promise<{ run_folder: string; run_id: string }>;
    listAudioDevices: () => Promise<AudioDevice[]>;
    /**
     * Run the engine's `testAudioCapture` helper: records ~4 s on mic and
     * AudioTee, returns per-channel volume stats so the UI can tell the
     * user whether each channel actually heard something. Used by the
     * "Diagnose audio" action in Settings → Audio.
     */
    testAudio: () => Promise<AudioTestReport>;
    /**
     * Start the live audio-level monitor (Settings → Audio meter).
     * Accepts an optional `micDevice` override so the meter can follow
     * the dropdown selection without requiring a config save first.
     * Returns the freshly enumerated device list as a side effect.
     */
    startAudioMonitor: (req?: { micDevice?: string }) => Promise<AudioDevice[]>;
    /** Stop the live audio-level monitor. */
    stopAudioMonitor: () => Promise<void>;
    /**
     * Swap the mic source on the active monitor without restarting AudioTee.
     * Returns the refreshed device list when no monitor was running and the
     * call had to start one from scratch; returns `null` when the live
     * session handled the swap in place.
     */
    switchAudioMonitorMic: (micDevice: string) => Promise<AudioDevice[] | null>;
  };
  // Runs
  runs: {
    list: () => Promise<RunSummary[]>;
    get: (runFolder: string) => Promise<RunDetail>;
    readDocument: (runFolder: string, fileName: string) => Promise<string>;
    getMediaSource: (runFolder: string, fileName: string) => Promise<string | null>;
    downloadMedia: (runFolder: string, fileName: string) => Promise<DownloadMediaResult>;
    deleteMedia: (runFolder: string, fileName: string) => Promise<void>;
    writeNotes: (runFolder: string, content: string) => Promise<void>;
    startProcessRecording: (req: ProcessRecordingRequest) => Promise<void>;
    processRecording: (req: ProcessRecordingRequest) => Promise<ReprocessResult>;
    startReprocess: (req: ReprocessRequest) => Promise<void>;
    reprocess: (req: ReprocessRequest) => Promise<ReprocessResult>;
    bulkReprocess: (req: BulkReprocessRequest) => Promise<BulkReprocessResult[]>;
    processMedia: (mediaToken: string, title: string) => Promise<{ run_folder: string }>;
    processDroppedMedia: (file: unknown, title: string) => Promise<{ run_folder: string }>;
    openInObsidian: (runFolder: string, fileName: string) => Promise<void>;
    openInFinder: (runFolder: string) => Promise<void>;
    deleteRun: (runFolder: string) => Promise<void>;
    bulkDelete: (runFolders: string[]) => Promise<void>;
    updateMeta: (req: UpdateMetaRequest) => Promise<void>;
    createDraft: (req: CreateDraftRequest) => Promise<CreateDraftResult>;
    writePrep: (runFolder: string, content: string) => Promise<void>;
    readPrep: (runFolder: string) => Promise<string>;
    addAttachment: (runFolder: string) => Promise<AddAttachmentResult | null>;
    removeAttachment: (runFolder: string, fileName: string) => Promise<void>;
    listAttachments: (runFolder: string) => Promise<Array<{ name: string; size: number }>>;
    updatePrep: (req: UpdatePrepRequest) => Promise<void>;
    reopenAsDraft: (runFolder: string) => Promise<void>;
    markComplete: (runFolder: string) => Promise<void>;
  };
  // Prompts
  prompts: {
    list: () => Promise<PromptRow[]>;
    save: (id: string, body: string, patch: Partial<PromptRow>) => Promise<void>;
    create: (id: string, label: string, filename: string, body: string) => Promise<void>;
    delete: (id: string) => Promise<void>;
    enable: (id: string, enabled: boolean) => Promise<void>;
    setAuto: (id: string, auto: boolean) => Promise<void>;
    resetToDefault: (id?: string) => Promise<void>;
    getDir: () => Promise<string>;
    openInFinder: (promptId?: string) => Promise<void>;
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
    runtime: () => Promise<OllamaRuntimeDTO>;
  };
  jobs: {
    list: () => Promise<JobSummary[]>;
    cancel: (jobId: string) => Promise<void>;
    tailLog: (jobId: string, lines: number) => Promise<string>;
  };
  system: {
    detectHardware: () => Promise<HardwareInfoDTO>;
    /**
     * Open System Settings → Privacy & Security → Screen & System Audio
     * Recording. Used from Settings when system audio capture appears to be
     * silently recording zeros because the TCC permission is not granted.
     */
    openAudioPermissionPane: () => Promise<void>;
    /** Open System Settings → Privacy & Security → Microphone. */
    openMicrophonePermissionPane: () => Promise<void>;
    /**
     * Return the app's display name and the **bundle name TCC shows in
     * System Settings**. In a packaged build they're both "Gistlist".
     * In dev, the bundle is "Electron" so users have to grant the
     * permission to "Electron" (not "Gistlist"). The UI uses
     * `tccBundleName` when telling the user what to look for.
     */
    getAppIdentity: () => Promise<{
      displayName: string;
      tccBundleName: string;
      /**
       * Absolute path to the running .app bundle (e.g.,
       * `/path/to/node_modules/electron/dist/Electron.app` in dev, or
       * `/Applications/Gistlist.app` in prod). Used so the UI can
       * "Reveal in Finder" — macOS often won't list an app in the System
       * Audio Recording Only list until it's been manually added via the
       * "+" button, which needs the bundle path.
       */
      bundlePath: string | null;
      isDev: boolean;
      isPackaged: boolean;
    }>;
    /** Open Finder with the running .app bundle selected so the user can drag it into System Settings. */
    revealAppBundle: () => Promise<void>;
    /** Trigger the macOS microphone permission prompt (no-op if already granted). */
    requestMicrophonePermission: () => Promise<{
      granted: boolean;
      status: string;
      error?: string;
    }>;
    /** Read microphone permission status without prompting. */
    getMicrophonePermission: () => Promise<{ status: string }>;
    /**
     * Probe whether AudioTee is actually receiving system audio. Returns
     * "granted" if we saw non-zero samples, "denied" if everything is
     * stuck at zero (classic TCC-permission-missing case), "unsupported"
     * on non-macOS, or "failed" on unexpected errors.
     */
    probeSystemAudioPermission: () => Promise<
      | {
          status: "granted" | "denied";
          totalSamples: number;
          zeroSamples: number;
          totalBytes: number;
        }
      | { status: "unsupported" }
      | { status: "failed"; error: string }
    >;
    /**
     * Fast OS-level read of mic + system-audio permission. Does not spawn
     * any capture processes. macOS 14.2+ "System Audio Recording Only" TCC
     * is part of the Screen Recording family, which is what `screen`
     * reports on.
     */
    getAudioPermissions: () => Promise<{
      microphone: "granted" | "denied" | "not-determined" | "restricted" | "unknown";
      systemAudio: "granted" | "denied" | "not-determined" | "restricted" | "unknown";
    }>;
  };
  // Logs
  logs: {
    tailApp: (lines: number) => Promise<string>;
    tailRun: (runFolder: string, lines: number) => Promise<string>;
    appPath: () => Promise<string>;
    listAppEntries: (query?: AppLogQuery) => Promise<AppLogEntry[]>;
    listProcesses: () => Promise<ActivityProcess[]>;
    revealApp: () => Promise<void>;
    revealOllama: () => Promise<void>;
    reportRendererError: (payload: {
      source: string;
      message: string;
      stack?: string;
      href?: string;
      userAgent?: string;
      detail?: string;
    }) => Promise<void>;
  };
  // Chat Launcher
  chatLauncher: {
    detectApps: () => Promise<ChatAppInfo[]>;
    launch: (req: LaunchChatRequest) => Promise<LaunchChatResult>;
  };
  // Meeting index (the corpus the MCP server reads; still needs renderer
  // controls for re-index + embed-model install).
  meetingIndex: {
    /**
     * Kick a backfill. Default scope (`"missing-chunks"`) re-indexes runs
     * with no chunks. `"missing-embeddings"` re-runs `indexRun` on FTS-only
     * runs so they pick up vector embeddings (used after restoring Ollama).
     */
    backfillStart: (
      arg?: { scope?: MeetingIndexBackfillScope },
    ) => Promise<MeetingIndexProgressDTO>;
    backfillStatus: () => Promise<MeetingIndexProgressDTO>;
    /** Best-effort hint for the UI "N meetings need indexing" message. */
    backfillCountPending: () => Promise<number>;
    /**
     * Single-roundtrip status snapshot for the Settings health panel.
     * Direct DB read — no Ollama probe.
     */
    health: () => Promise<MeetingIndexHealthDTO>;
    /** Check whether the embedding model is installed via Ollama. */
    embedModelStatus: () => Promise<{ model: string; installed: boolean }>;
    /** Start a pull of the embedding model. Progress streams via setupLlmLog. */
    installEmbedModel: () => Promise<void>;
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
  // Integrations tab — Claude Desktop MCP server (written into
  // claude_desktop_config.json, see main/integrations.ts).
  integrations: {
    getMcpStatus: () => Promise<McpIntegrationStatus>;
    installMcpForClaude: () => Promise<McpInstallResult>;
    uninstallMcpForClaude: () => Promise<McpInstallResult>;
  };
  // gistlist:// deep-link subscription handshake (see main/deep-link.ts).
  deepLink: {
    /** Signal the main process that the renderer is ready to receive
     *  `open-meeting` app actions. Call after subscribing to appAction. */
    ready: () => void;
  };
  // Feedback / support — mailto + reveal-logs entry points wired
  // from tray menu, Settings, and Help menu. Opens the user's default
  // mail client (no automatic attachments — mailto can't carry files;
  // use revealLogsInFinder to attach manually).
  support: {
    openFeedbackMail: () => Promise<void>;
    revealLogsInFinder: () => Promise<void>;
    /** Open the bundled THIRD_PARTY_LICENSES.md in the user's default viewer. */
    openLicensesFile: () => Promise<void>;
  };
  // electron-updater. When `UPDATER_ENABLED` is false at build time
  // (publish.repo not configured), every method returns `{ enabled: false }`-
  // shaped results — the renderer reads `enabled` once on startup and
  // hides the entire UI surface when disabled.
  updater: {
    getStatus: () => Promise<UpdaterStatus>;
    check: () => Promise<UpdaterStatus>;
    download: () => Promise<UpdaterStatus>;
    install: () => Promise<UpdaterStatus>;
    getPrefs: () => Promise<UpdaterPreferences>;
    setPrefs: (prefs: UpdaterPreferences) => Promise<UpdaterPreferences>;
    /** Dev-only simulator. Production builds reject calls (returns disabled status). */
    simulate: (
      action: UpdaterSimulatorAction,
      payload?: { version?: string; message?: string }
    ) => Promise<UpdaterStatus | { ok: false; status: "simulated-install-blocked" }>;
  };
  // Events (subscribe)
  on: {
    recordingStatus: (cb: (status: RecordingStatus) => void) => () => void;
    pipelineProgress: (cb: (event: PipelineProgressEvent) => void) => () => void;
    setupAsrLog: (cb: (line: string) => void) => () => void;
    setupLlmLog: (cb: (line: string) => void) => () => void;
    setupLlmProgress: (cb: (progress: { pct: number; completed: number; total: number }) => void) => () => void;
    depsInstallLog: (cb: (line: string) => void) => () => void;
    appAction: (cb: (event: AppActionEvent) => void) => () => void;
    jobUpdate: (cb: (job: JobSummary) => void) => () => void;
    logEntry: (cb: (entry: AppLogEntry) => void) => () => void;
    processUpdate: (cb: (process: ActivityProcess) => void) => () => void;
    audioMonitorLevels: (cb: (snapshot: AudioMonitorSnapshot) => void) => () => void;
    meetingIndexBackfillProgress: (cb: (progress: MeetingIndexProgressDTO) => void) => () => void;
    /** Per-phase progress events from the wizard installer. */
    installerProgress: (cb: (event: InstallerProgressEvent) => void) => () => void;
    /** Status updates from electron-updater (or the dev simulator). */
    updaterStatus: (cb: (status: UpdaterStatus) => void) => () => void;
  };
}

declare global {
  interface Window {
    api: GistlistApi;
  }
}
