import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { ipcMain, dialog, shell, clipboard, app, systemPreferences } from "electron";
import matter from "gray-matter";
import {
  loadConfig,
  saveConfig,
  getConfigDir,
  getAppLogPath,
  resolveBasePath,
  resolveRunsPath,
  initProject as engineInitProject,
  moveDataDirectory,
  loadRunManifest,
  createDraftRun,
  loadAllPrompts,
  updatePromptFrontmatter,
  resetDefaultPrompts,
  getPromptsDir,
  isAllowedPromptOutputFilename,
  DEFAULT_PROMPTS_DIR,
  FfmpegRecorder,
  openInObsidian,
  createAppLogger,
  setupAsr,
  setupLlm,
  checkOllama,
  listOllamaModels,
  listRunningOllamaModels,
  deleteOllamaModel,
  processRun,
  getSecret,
  setSecret,
  hasSecret,
  OperationAbortedError,
  testAudioCapture,
  type AppConfig,
  type LlmProvider,
  type PipelineProgressEvent,
  type RunManifest,
} from "@gistlist/engine";

const appLogger = createAppLogger(Boolean(process.env.VITE_DEV_SERVER_URL));
import { ensureOllamaDaemon, getOllamaState } from "./ollama-daemon.js";
import { resolveBin } from "./bundled.js";
import { installTool } from "./installers/install-tool.js";
import {
  checkForUpdates,
  startDownload,
  installAndRestart,
  getStatus as getUpdaterStatus,
  loadPrefs as loadUpdaterPrefs,
  savePrefs as saveUpdaterPrefs,
  updaterEnabled,
} from "./updater.js";
import { dispatchSimulator } from "./updater-dev.js";
import { openFeedbackMail, revealLogsInFinder, openLicensesFile } from "./feedback.js";
import { startAudioMonitor, stopAudioMonitor, switchMonitorMic } from "./audio-monitor.js";
import { resolveAudioTeeBinary } from "./audiotee-binary.js";
import { listAppEntries, listProcesses, trackChildProcess } from "./activity-monitor.js";
import { detectHardware, isSystemAudioSupported } from "./system.js";
import { registerMeetingIndexIpc } from "./meeting-index/ipc.js";
import {
  getMcpStatus,
  installMcpForClaude,
  uninstallMcpForClaude,
} from "./integrations.js";
import { indexRun as chatIndexRun } from "./chat-index/index-run.js";
import { createOllamaEmbedder, DEFAULT_EMBEDDING_MODEL } from "@gistlist/engine";
import type {
  AppActionEvent,
  AppLogQuery,
  AppConfigDTO,
  InitConfigRequest,
  ProcessRecordingRequest,
  RecordingStatus,
  RunSummary,
  RunDetail,
  ReprocessRequest,
  BulkReprocessRequest,
  ReprocessResult,
  BulkReprocessResult,
  PromptRow,
  StartRecordingRequest,
  StopRecordingRequest,
  PipelineProgressEvent as AppPipelineProgressEvent,
  DepsCheckResult,
  DepsInstallResult,
  DepsInstallTarget,
  ResolvedTool,
  InstallerProgressEvent,
  UpdaterPreferences,
  UpdaterSimulatorAction,
  DetectedVault,
  JobSummary,
  OllamaRuntimeDTO,
  ChatAppInfo,
  LaunchChatRequest,
  LaunchChatResult,
  CreateDraftRequest,
  AddAttachmentResult,
  StartRecordingForDraftRequest,
  UpdatePrepRequest,
  ContinueRecordingRequest,
} from "../shared/ipc.js";
import {
  getStatus as getRecordingStatus,
  startRecording,
  stopRecording,
  stopActiveRecording as stopActive,
  startRecordingForDraft,
  pauseRecording,
  resumeRecording,
  continueRecording,
} from "./recording.js";
import {
  resolveRunDocumentPath,
  resolveRunFolderPath,
  resolveRunMediaPath,
  resolveRunAttachmentPath,
  partitionRunFoldersForBulkDelete,
  listRunFiles,
  computeRunFolderSize,
  inferAudioStorage,
  RUN_LOG_FILE,
  RUN_NOTES_FILE,
  RUN_PREP_FILE,
  RUN_ATTACHMENTS_DIR,
} from "./run-access.js";
import { bulkReprocessRuns, processRecordedRun, reprocessRun } from "./runs-service.js";
import { validatePromptModelSelection } from "./model-validation.js";
import { getRunSortValue } from "../shared/sort.js";
import { syncToggleRecordingShortcut } from "./shortcuts.js";
import { assertImportMediaPath, type PickedMediaFile } from "./media-import.js";
import { broadcastToAll } from "./events.js";
import { cancelJob, getJobLog, listJobs, scheduleJob, updateJobProgress } from "./jobs.js";
import { getCachedAudioDevices, invalidateDeviceCache } from "./device-cache.js";
import { getStore } from "./store.js";

export { stopActive as stopActiveRecording };

const execFileAsync = promisify(execFile);
const pendingMediaSelections = new Map<string, string>();

// ---- Helpers ----

function configToDto(config: AppConfig): AppConfigDTO {
  return {
    data_path: config.data_path,
    obsidian_integration: {
      enabled: config.obsidian_integration.enabled,
      vault_name: config.obsidian_integration.vault_name,
      vault_path: config.obsidian_integration.vault_path,
    },
    asr_provider: config.asr_provider,
    llm_provider: config.llm_provider,
    whisper_local: config.whisper_local,
    parakeet_mlx: config.parakeet_mlx,
    claude: config.claude,
    openai: config.openai,
    ollama: config.ollama,
    recording: config.recording,
    shortcuts: config.shortcuts,
    chat_launcher: config.chat_launcher,
    audio_retention_days: config.audio_retention_days,
    audio_storage_mode: config.audio_storage_mode,
  };
}

function dtoToConfig(dto: AppConfigDTO): AppConfig {
  return {
    data_path: dto.data_path,
    obsidian_integration: {
      enabled: dto.obsidian_integration.enabled,
      vault_name: dto.obsidian_integration.vault_name,
      vault_path: dto.obsidian_integration.vault_path,
    },
    asr_provider: dto.asr_provider,
    llm_provider: dto.llm_provider,
    whisper_local: dto.whisper_local,
    parakeet_mlx: dto.parakeet_mlx,
    claude: dto.claude,
    openai: dto.openai,
    ollama: dto.ollama,
    // The renderer DTO only surfaces user-visible recording fields; fill in
    // engine-internal defaults for AEC + dedup (both on by default).
    recording: {
      mic_device: dto.recording.mic_device,
      system_device: dto.recording.system_device,
      aec_enabled: true,
      dedup_me_against_others: true,
      voice_processing_enabled: dto.recording.voice_processing_enabled ?? false,
    },
    shortcuts: dto.shortcuts,
    chat_launcher: dto.chat_launcher,
    audio_retention_days: dto.audio_retention_days,
    audio_storage_mode: dto.audio_storage_mode ?? "compact",
  };
}

function safeLoadConfig(): AppConfig | null {
  try {
    return loadConfig();
  } catch {
    return null;
  }
}

function isAbortLikeError(err: unknown): boolean {
  return err instanceof OperationAbortedError || (err instanceof Error && err.name === "AbortError");
}

function toRunSummary(
  manifest: RunManifest,
  folderPath: string,
  updatedAt?: string | null,
  folderSizeBytes?: number | null
): RunSummary {
  return {
    run_id: manifest.run_id,
    title: manifest.title,
    description: manifest.description ?? null,
    date: manifest.date,
    started: manifest.started,
    ended: manifest.ended,
    status: manifest.status,
    source_mode: manifest.source_mode,
    duration_minutes: manifest.duration_minutes,
    tags: manifest.tags,
    folder_path: folderPath,
    prompt_output_ids: Object.keys(manifest.prompt_outputs),
    scheduled_time: manifest.scheduled_time ?? null,
    updated_at: updatedAt ?? null,
    folder_size_bytes: folderSizeBytes ?? null,
  };
}

function safeFolderSize(folderPath: string): number | null {
  try {
    return computeRunFolderSize(folderPath);
  } catch {
    return null;
  }
}

function walkRunFolders(runsRoot: string): string[] {
  if (!fs.existsSync(runsRoot)) return [];
  const folders: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      const indexMd = path.join(full, "index.md");
      if (fs.existsSync(indexMd)) {
        folders.push(full);
      } else {
        walk(full);
      }
    }
  };
  walk(runsRoot);
  return folders;
}

// Track the prior recording state so we can fire a one-shot transition
// hook when recording goes from active → not active. The updater needs
// this to drain any deferred download/install requests that piled up
// during recording (see main/updater.ts).
let lastRecordingActive = false;

export function broadcastRecordingStatus(): void {
  void getRecordingStatus().then((status) => {
    broadcastToAll("recording:status", status);
    const nowActive = !!status.active;
    if (lastRecordingActive && !nowActive) {
      // Fire-and-forget — the updater handles its own errors.
      void import("./updater.js").then((m) => m.onRecordingStopped()).catch(() => {});
    }
    lastRecordingActive = nowActive;
  });
}

function forwardProgress(runFolder: string, event: PipelineProgressEvent): void {
  const translated: AppPipelineProgressEvent = {
    ...event,
    runFolder,
  } as AppPipelineProgressEvent;
  broadcastToAll("pipeline:progress", translated);
}

export function broadcastAppAction(event: AppActionEvent): void {
  broadcastToAll("app:action", event);
}

async function handleReprocess(req: ReprocessRequest): Promise<ReprocessResult> {
  const kind = req.onlyIds && req.onlyIds.length === 1 ? "run-prompt" : "reprocess-run";
  const subtitle =
    kind === "run-prompt"
      ? "Running a selected prompt for this meeting"
      : "Reprocessing meeting outputs";
  const config = loadConfig();
  const store = getStore();
  const manifest = store.loadManifest(resolveRunFolderPath(req.runFolder, config));
  return scheduleJob({
    kind,
    title: manifest.title,
    subtitle,
    runFolder: req.runFolder,
    promptIds: req.onlyIds,
    task: async ({ signal, updateProgress }) => {
      const result = await reprocessRun(
        req,
        (event: PipelineProgressEvent) => {
          updateProgress(event);
          forwardProgress(req.runFolder, event);
        },
        signal
      );
      broadcastToAll("pipeline:progress", {
        type: "run-complete",
        runFolder: result.runFolder,
        succeeded: result.succeeded,
        failed: result.failed,
      } satisfies AppPipelineProgressEvent);
      if (result.failed.length > 0) {
        throw new Error(
          `${result.failed.length} prompt output(s) failed: ${result.failed.join(", ")}`
        );
      }
      return result;
    },
  });
}

function startReprocessInBackground(req: ReprocessRequest): void {
  void handleReprocess(req).catch((err) => {
    if (isAbortLikeError(err)) return;
    broadcastToAll("pipeline:progress", {
      type: "run-failed",
      runFolder: req.runFolder,
      error: err instanceof Error ? err.message : String(err),
    } satisfies AppPipelineProgressEvent);
  });
}

async function handleProcessRecording(req: ProcessRecordingRequest): Promise<ReprocessResult> {
  const config = loadConfig();
  const validatedRunFolder = resolveRunFolderPath(req.runFolder, config);
  const store = getStore();
  const manifest = store.loadManifest(validatedRunFolder);
  store.updateStatus(validatedRunFolder, "processing");
  const subtitle =
    req.onlyIds && req.onlyIds.length > 0
      ? "Processing selected meeting outputs"
      : "Building transcript";
  return scheduleJob({
    kind: "process-recording",
    title: manifest.title,
    subtitle,
    runFolder: req.runFolder,
    promptIds: req.onlyIds,
    task: async ({ signal, updateProgress }) => {
      const result = await processRecordedRun(
        req,
        (event: PipelineProgressEvent) => {
          updateProgress(event);
          forwardProgress(req.runFolder, event);
        },
        signal
      );
      broadcastToAll("pipeline:progress", {
        type: "run-complete",
        runFolder: result.runFolder,
        succeeded: result.succeeded,
        failed: result.failed,
      } satisfies AppPipelineProgressEvent);
      if (result.failed.length > 0) {
        throw new Error(
          `${result.failed.length} prompt output(s) failed: ${result.failed.join(", ")}`
        );
      }
      return result;
    },
  });
}

function startProcessRecordingInBackground(req: ProcessRecordingRequest): void {
  void handleProcessRecording(req).catch((err) => {
    if (isAbortLikeError(err)) return;
    try {
      const config = loadConfig();
      const validatedRunFolder = resolveRunFolderPath(req.runFolder, config);
      getStore().updateStatus(validatedRunFolder, "error", { ended: new Date().toISOString() });
    } catch {
      // Best effort: the renderer still receives the run-failed event below.
    }
    broadcastToAll("pipeline:progress", {
      type: "run-failed",
      runFolder: req.runFolder,
      error: err instanceof Error ? err.message : String(err),
    } satisfies AppPipelineProgressEvent);
  });
}

// ---- Handler registration ----

export function registerIpcHandlers(): void {
  // ---- config ----
  ipcMain.handle("config:get", async (): Promise<AppConfigDTO | null> => {
    const config = safeLoadConfig();
    return config ? configToDto(config) : null;
  });

  ipcMain.handle("config:save", async (_e, dto: AppConfigDTO) => {
    const nextConfig = dtoToConfig(dto);
    const currentConfig = safeLoadConfig();
    if (currentConfig?.shortcuts.toggle_recording !== nextConfig.shortcuts.toggle_recording) {
      const shortcutResult = syncToggleRecordingShortcut(nextConfig.shortcuts.toggle_recording);
      if (!shortcutResult.ok) {
        throw new Error(
          `Could not register shortcut "${nextConfig.shortcuts.toggle_recording}". ` +
            `Choose a different combination and try again.`
        );
      }
    }
    saveConfig(nextConfig);
  });

  ipcMain.handle("config:init", async (_e, req: InitConfigRequest) => {
    // Auto-detect the default mic from AVFoundation. System audio is
    // captured automatically via AudioTee — no device name needed.
    let micDevice = req.recording.mic_device;
    if (!micDevice) {
      try {
        const recorder = new FfmpegRecorder();
        const devices = await recorder.listAudioDevices();
        if (!micDevice) micDevice = devices[0] ?? "";
      } catch {
        // ffmpeg missing — leave fields empty; deps step will flag ffmpeg.
      }
    }
    const systemDevice = ""; // System audio handled by AudioTee, not a device

    const llmProvider = req.llm_provider ?? "claude";
    const config: AppConfig = {
      data_path: req.data_path.replace(/^~/, os.homedir()),
      obsidian_integration: req.obsidian_integration,
      asr_provider: req.asr_provider,
      llm_provider: llmProvider,
      whisper_local: {
        binary_path: "whisper-cli",
        model_path: "",
      },
      parakeet_mlx: {
        binary_path: path.join(getConfigDir(), "parakeet-venv", "bin", "mlx_audio.stt.generate"),
        model: "mlx-community/parakeet-tdt-0.6b-v2",
      },
      claude: { model: "claude-sonnet-4-6" },
      openai: { model: "gpt-4o" },
      ollama: {
        base_url: "http://127.0.0.1:11434",
        model: req.ollama_model ?? "qwen3.5:9b",
      },
      recording: {
        mic_device: micDevice,
        system_device: systemDevice,
        aec_enabled: true,
        dedup_me_against_others: true,
        voice_processing_enabled: false,
      },
      shortcuts: { toggle_recording: "CommandOrControl+Shift+M" },
      audio_retention_days: req.audio_retention_days ?? null,
      audio_storage_mode: req.audio_storage_mode ?? "compact",
    };
    if (req.claude_api_key) await setSecret("claude", req.claude_api_key);
    if (req.openai_api_key) await setSecret("openai", req.openai_api_key);
    engineInitProject(config);
    syncToggleRecordingShortcut(config.shortcuts.toggle_recording);
  });

  ipcMain.handle("config:set-data-path", async (_e, newPath: string) => {
    const config = loadConfig();
    const { result } = moveDataDirectory(config, newPath);
    return { from: result.from, to: result.to };
  });

  ipcMain.handle("config:set-obsidian-enabled", async (_e, enabled: boolean) => {
    const config = loadConfig();
    config.obsidian_integration = {
      ...config.obsidian_integration,
      enabled,
    };
    saveConfig(config);
  });

  ipcMain.handle("config:set-obsidian-vault", async (_e, vaultPath: string) => {
    const config = loadConfig();
    const resolved = vaultPath.replace(/^~/, os.homedir());
    config.obsidian_integration = {
      ...config.obsidian_integration,
      vault_path: resolved,
      vault_name: path.basename(resolved),
    };
    saveConfig(config);
  });

  ipcMain.handle("config:open-data-directory", async () => {
    const config = loadConfig();
    shell.showItemInFolder(resolveBasePath(config));
  });

  ipcMain.handle("config:pick-directory", async (_e, opts?: { defaultPath?: string }) => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      defaultPath: opts?.defaultPath,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("config:pick-media-file", async (): Promise<PickedMediaFile | null> => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [
        {
          name: "Meeting media",
          extensions: ["mp4", "mov", "m4v", "webm", "mkv", "avi", "mp3", "m4a", "wav", "aiff", "flac", "ogg"],
        },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const mediaPath = assertImportMediaPath(result.filePaths[0]);
    const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    pendingMediaSelections.set(token, mediaPath);
    return { token, name: path.basename(mediaPath) };
  });

  // ---- recording ----
  ipcMain.handle("recording:get-status", async (): Promise<RecordingStatus> => {
    return getRecordingStatus();
  });

  ipcMain.handle("recording:start", async (_e, req: StartRecordingRequest) => {
    const result = await startRecording(req.title, req.description ?? null);
    broadcastRecordingStatus();
    return result;
  });

  ipcMain.handle("recording:stop", async (_e, req?: StopRecordingRequest) => {
    const result = await stopRecording({
      mode: req?.mode ?? "process",
      onProgress: (runFolder, event) => {
        forwardProgress(runFolder, event);
      },
    });
    broadcastRecordingStatus();
    return result;
  });

  ipcMain.handle("recording:list-audio-devices", async () => {
    const devices = await getCachedAudioDevices();
    // Trigger a background refresh so the next call picks up any changes.
    invalidateDeviceCache();
    return devices.map((name) => ({ name }));
  });

  ipcMain.handle("recording:test-audio", async () => {
    const config = loadConfig();
    return testAudioCapture({
      micDevice: config.recording.mic_device,
      systemDevice: config.recording.system_device,
      durationMs: 4000,
    });
  });

  ipcMain.handle(
    "audio-monitor:start",
    async (_e, req?: { micDevice?: string }) => {
      const config = loadConfig();
      // Always re-enumerate devices so USB plug/unplug shows up immediately
      // in the Settings dropdown and the meter picks the right source.
      invalidateDeviceCache();
      const devices = await getCachedAudioDevices();
      await startAudioMonitor({
        micDevice: req?.micDevice ?? config.recording.mic_device,
        availableDevices: devices,
      });
      return devices.map((name) => ({ name }));
    }
  );

  ipcMain.handle("audio-monitor:stop", async () => {
    await stopAudioMonitor();
  });

  ipcMain.handle(
    "audio-monitor:switch-mic",
    async (_e, req: { micDevice: string }) => {
      // Light path used when the user just picked a different mic in the
      // dropdown — avoids the AudioTee restart that surfaces as a flicker
      // on the system-audio meter/banner.
      const handled = await switchMonitorMic(req.micDevice);
      if (!handled) {
        const config = loadConfig();
        invalidateDeviceCache();
        const devices = await getCachedAudioDevices();
        await startAudioMonitor({
          micDevice: req.micDevice || config.recording.mic_device,
          availableDevices: devices,
        });
        return devices.map((name) => ({ name }));
      }
      return null;
    }
  );

  ipcMain.handle("system:open-audio-permission-pane", async () => {
    // Deep-link into System Settings → Privacy & Security → Screen & System
    // Audio Recording. This is where the "System Audio Recording Only" list
    // lives; the user needs to add whatever bundle is running AudioTee
    // (Electron in dev, the signed app in prod, or the terminal emulator for
    // CLI usage).
    const url = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
    await shell.openExternal(url);
  });

  ipcMain.handle("system:open-microphone-permission-pane", async () => {
    const url = "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
    await shell.openExternal(url);
  });

  ipcMain.handle("system:get-app-identity", async () => {
    // `app.getName()` returns whatever `app.setName()` set, which is
    // "Gistlist" since we call setName in main/index.ts. But TCC
    // identifies apps by the **bundle** — in dev the bundle is Electron.
    // Expose both so the UI can tell users what name to look for in
    // System Settings.
    const isDev = Boolean(process.env.VITE_DEV_SERVER_URL) || !app.isPackaged;
    const displayName = app.getName();
    const tccBundleName = isDev ? "Electron" : displayName;

    // Resolve the running .app bundle path so the UI can offer a
    // "Reveal in Finder" button. macOS often won't show an app in the
    // System Audio Recording list until it's been added via the "+"
    // button — revealing the bundle makes that trivial.
    let bundlePath: string | null = null;
    try {
      const exe = app.getPath("exe");
      // /path/to/Electron.app/Contents/MacOS/Electron  →  /path/to/Electron.app
      const appBundleIdx = exe.lastIndexOf(".app/");
      if (appBundleIdx !== -1) {
        bundlePath = exe.slice(0, appBundleIdx + 4);
      }
    } catch {
      // ignore
    }

    return {
      displayName,
      tccBundleName,
      bundlePath,
      isDev,
      isPackaged: app.isPackaged,
    };
  });

  ipcMain.handle("system:reveal-app-bundle", async () => {
    try {
      const exe = app.getPath("exe");
      const appBundleIdx = exe.lastIndexOf(".app/");
      const bundlePath = appBundleIdx !== -1 ? exe.slice(0, appBundleIdx + 4) : exe;
      shell.showItemInFolder(bundlePath);
    } catch {
      // ignore
    }
  });

  ipcMain.handle("system:request-microphone-permission", async () => {
    // `systemPreferences.askForMediaAccess` prompts for microphone access and
    // returns the result. On macOS it immediately returns true if already
    // granted, false if denied, or triggers the system prompt on first call.
    if (process.platform !== "darwin") return { granted: true, status: "granted" as const };
    try {
      const granted = await systemPreferences.askForMediaAccess("microphone");
      const status = systemPreferences.getMediaAccessStatus("microphone");
      return { granted, status };
    } catch (err) {
      return {
        granted: false,
        status: "error" as const,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle("system:get-microphone-permission", async () => {
    if (process.platform !== "darwin") return { status: "granted" as const };
    return { status: systemPreferences.getMediaAccessStatus("microphone") };
  });

  ipcMain.handle("system:get-audio-permissions", async () => {
    // Fast, authoritative read of the OS-level permission statuses. Does not
    // spawn AudioTee or ffmpeg — safe to call on every mount / route change.
    // macOS 14.2+ treats the "System Audio Recording Only" TCC as part of the
    // Screen Recording family, which is what `getMediaAccessStatus('screen')`
    // reports, so we use it as the system-audio proxy.
    if (process.platform !== "darwin") {
      return { microphone: "granted" as const, systemAudio: "granted" as const };
    }
    return {
      microphone: systemPreferences.getMediaAccessStatus("microphone"),
      systemAudio: systemPreferences.getMediaAccessStatus("screen"),
    };
  });

  ipcMain.handle("system:probe-system-audio-permission", async () => {
    // AudioTee has no pre-flight permission check — when the "System Audio
    // Recording Only" TCC permission isn't granted it happily streams buffers
    // of all-zero bytes instead of erroring. Probe by starting a brief
    // capture and checking whether *any* non-zero sample arrives. Used by
    // the setup wizard and the Settings meter.
    if (process.platform !== "darwin") {
      return { status: "unsupported" as const };
    }
    try {
      const { AudioTee } = await import("audiotee");
      const tee = new AudioTee({ sampleRate: 16000, binaryPath: resolveAudioTeeBinary() });
      let totalSamples = 0;
      let zeroSamples = 0;
      let totalBytes = 0;
      tee.on("data", (chunk: { data?: Buffer }) => {
        if (!chunk.data) return;
        totalBytes += chunk.data.length;
        const len = chunk.data.length - (chunk.data.length % 2);
        for (let i = 0; i < len; i += 2) {
          let s = chunk.data[i] | (chunk.data[i + 1] << 8);
          if (s & 0x8000) s |= ~0xffff;
          if (s === 0) zeroSamples += 1;
          totalSamples += 1;
        }
      });
      await tee.start();
      // Give AudioTee a chance to deliver data. ~1.6 s is enough at 16k.
      await new Promise((resolve) => setTimeout(resolve, 1600));
      await tee.stop();
      if (totalBytes === 0) {
        return { status: "failed" as const, error: "AudioTee started but never produced data." };
      }
      if (totalSamples >= 4000 && zeroSamples === totalSamples) {
        return { status: "denied" as const, totalSamples, zeroSamples, totalBytes };
      }
      return { status: "granted" as const, totalSamples, zeroSamples, totalBytes };
    } catch (err) {
      return {
        status: "failed" as const,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle(
    "recording:start-for-draft",
    async (_e, req: StartRecordingForDraftRequest) => {
      const result = await startRecordingForDraft(req.runFolder);
      broadcastRecordingStatus();
      return result;
    }
  );

  ipcMain.handle("recording:pause", async () => {
    await pauseRecording();
    broadcastRecordingStatus();
  });

  ipcMain.handle("recording:resume", async () => {
    await resumeRecording();
    broadcastRecordingStatus();
  });

  ipcMain.handle(
    "recording:continue",
    async (_e, req: ContinueRecordingRequest) => {
      const result = await continueRecording(req.runFolder);
      broadcastRecordingStatus();
      return result;
    }
  );

  // ---- runs ----
  ipcMain.handle("runs:list", async (): Promise<RunSummary[]> => {
    try {
      const store = getStore();
      const all = store.listRuns();
      // Prune stale DB entries whose folders no longer exist on disk
      const stale: string[] = [];
      const valid: RunSummary[] = [];
      for (const { manifest, folderPath, updatedAt } of all) {
        if (fs.existsSync(path.join(folderPath, "index.md"))) {
          valid.push(toRunSummary(manifest, folderPath, updatedAt, safeFolderSize(folderPath)));
        } else {
          stale.push(folderPath);
        }
      }
      if (stale.length > 0) {
        store.deleteRuns(stale);
      }
      return valid.sort(
        (a, b) => getRunSortValue(b) - getRunSortValue(a)
      );
    } catch {
      return [];
    }
  });

  ipcMain.handle("runs:get", async (_e, runFolder: string): Promise<RunDetail> => {
    const config = loadConfig();
    let validatedRunFolder: string;
    try {
      validatedRunFolder = resolveRunFolderPath(runFolder, config);
    } catch {
      // Folder is gone — prune from DB and throw a user-friendly error
      getStore().deleteRun(runFolder);
      throw new Error("This meeting no longer exists on disk.");
    }
    const store = getStore();
    const manifest = store.loadManifest(validatedRunFolder);
    const files = listRunFiles(validatedRunFolder, config);
    const folderSizeBytes = files.reduce((sum, file) => sum + file.size, 0);
    return {
      ...toRunSummary(manifest, validatedRunFolder, null, folderSizeBytes),
      manifest,
      files,
      audioStorage: inferAudioStorage(files),
    };
  });

  ipcMain.handle("runs:read-document", async (_e, runFolder: string, fileName: string) => {
    const config = loadConfig();
    const filePath = resolveRunDocumentPath(runFolder, fileName, config);
    try {
      return await fs.promises.readFile(filePath, "utf-8");
    } catch (err: any) {
      if (err.code === "ENOENT") return "";
      throw err;
    }
  });

  ipcMain.handle("runs:get-media-source", async (_e, runFolder: string, fileName: string) => {
    const config = loadConfig();
    try {
      const filePath = resolveRunMediaPath(runFolder, fileName, config);
      if (!fs.existsSync(filePath)) return null;
      // Return raw bytes + mime so the preload bridge creates a blob: URL.
      // blob: URLs are the only approach that reliably passes Chromium's
      // media URL safety check across both dev (Vite) and production (file://).
      const data = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase().slice(1);
      const mimeMap: Record<string, string> = {
        wav: "audio/wav", mp3: "audio/mpeg", m4a: "audio/mp4",
        ogg: "audio/ogg", opus: "audio/ogg", flac: "audio/flac", aiff: "audio/aiff",
        mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
      };
      const mime = mimeMap[ext] ?? "application/octet-stream";
      return { buffer: data.buffer, mime };
    } catch {
      return null;
    }
  });

  ipcMain.handle("runs:download-media", async (_e, runFolder: string, fileName: string) => {
    const config = loadConfig();
    const filePath = resolveRunMediaPath(runFolder, fileName, config);
    const result = await dialog.showSaveDialog({
      defaultPath: path.basename(filePath),
    });
    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }
    fs.copyFileSync(filePath, result.filePath);
    return { canceled: false };
  });

  ipcMain.handle("runs:delete-media", async (_e, runFolder: string, fileName: string) => {
    const config = loadConfig();
    const filePath = resolveRunMediaPath(runFolder, fileName, config);
    fs.rmSync(filePath, { force: true });
  });

  ipcMain.handle("runs:write-notes", async (_e, runFolder: string, content: string) => {
    const config = loadConfig();
    const filePath = resolveRunDocumentPath(runFolder, RUN_NOTES_FILE, config);
    fs.writeFileSync(filePath, content, "utf-8");
  });

  ipcMain.handle("runs:start-process-recording", async (_e, req: ProcessRecordingRequest) => {
    startProcessRecordingInBackground(req);
  });

  ipcMain.handle("runs:process-recording", async (_e, req: ProcessRecordingRequest) => {
    try {
      return await handleProcessRecording(req);
    } catch (err) {
      if (isAbortLikeError(err)) {
        throw err;
      }
      try {
        const config = loadConfig();
        const validatedRunFolder = resolveRunFolderPath(req.runFolder, config);
        getStore().updateStatus(validatedRunFolder, "error", { ended: new Date().toISOString() });
      } catch {
        // Best effort: the renderer still receives the run-failed event below.
      }
      broadcastToAll("pipeline:progress", {
        type: "run-failed",
        runFolder: req.runFolder,
        error: err instanceof Error ? err.message : String(err),
      } satisfies AppPipelineProgressEvent);
      throw err;
    }
  });

  ipcMain.handle("runs:start-reprocess", async (_e, req: ReprocessRequest) => {
    startReprocessInBackground(req);
  });

  ipcMain.handle("runs:reprocess", async (_e, req: ReprocessRequest) => {
    try {
      return await handleReprocess(req);
    } catch (err) {
      if (isAbortLikeError(err)) {
        throw err;
      }
      broadcastToAll("pipeline:progress", {
        type: "run-failed",
        runFolder: req.runFolder,
        error: err instanceof Error ? err.message : String(err),
      } satisfies AppPipelineProgressEvent);
      throw err;
    }
  });

  ipcMain.handle("runs:bulk-reprocess", async (_e, req: BulkReprocessRequest): Promise<BulkReprocessResult[]> => {
    return bulkReprocessRuns(req, async (singleReq) => {
      try {
        return await handleReprocess(singleReq);
      } catch (err) {
        if (isAbortLikeError(err)) {
          throw err;
        }
        broadcastToAll("pipeline:progress", {
          type: "run-failed",
          runFolder: singleReq.runFolder,
          error: err instanceof Error ? err.message : String(err),
        } satisfies AppPipelineProgressEvent);
        throw err;
      }
    });
  });

  const importMediaRun = async (mediaPath: string, title: string) => {
    const config = loadConfig();
    const validatedMediaPath = assertImportMediaPath(mediaPath);
    const { createRun, mediaHasAudioStream } = await import("@gistlist/engine");
    if (!(await mediaHasAudioStream(validatedMediaPath))) {
      throw new Error("This recording does not contain a usable audio track.");
    }

    const runContext = createRun(config, title, { sourceMode: "file", quiet: true });
    getStore().insertRun(runContext.manifest, runContext.folderPath);
    const audioDir = path.join(runContext.folderPath, "audio");
    fs.mkdirSync(audioDir, { recursive: true });
    const destMedia = path.join(audioDir, path.basename(validatedMediaPath));
    fs.copyFileSync(validatedMediaPath, destMedia);

    void scheduleJob({
      kind: "process-import",
      title,
      subtitle: "Processing imported media",
      runFolder: runContext.folderPath,
      task: async ({ signal, updateProgress }) => {
        try {
          const result = await processRun({
            config,
            runFolder: runContext.folderPath,
            title,
            date: runContext.manifest.date,
            audioFiles: [{ path: destMedia, speaker: "unknown" }],
            logger: runContext.logger,
            signal,
            onProgress: (event) => {
              updateProgress(event);
              forwardProgress(runContext.folderPath, event);
            },
          });
          if (result.failed.length > 0) {
            throw new Error(
              `${result.failed.length} prompt output(s) failed: ${result.failed.join(", ")}`
            );
          }
          return result;
        } catch (err) {
          if (!isAbortLikeError(err)) {
            broadcastToAll("pipeline:progress", {
              type: "run-failed",
              runFolder: runContext.folderPath,
              error: err instanceof Error ? err.message : String(err),
            } satisfies AppPipelineProgressEvent);
          }
          throw err;
        }
      },
    }).catch(() => {});

    return { run_folder: runContext.folderPath };
  };

  ipcMain.handle("runs:process-media", async (_e, mediaToken: string, title: string) => {
    const mediaPath = pendingMediaSelections.get(mediaToken);
    if (!mediaPath) {
      throw new Error("The selected media file is no longer available. Pick it again and retry.");
    }
    pendingMediaSelections.delete(mediaToken);
    return importMediaRun(mediaPath, title);
  });

  ipcMain.handle("runs:process-dropped-media", async (_e, mediaPath: string, title: string) => {
    return importMediaRun(mediaPath, title);
  });

  ipcMain.handle("runs:open-in-obsidian", async (_e, runFolder: string, fileName: string) => {
    const config = loadConfig();
    const filePath = resolveRunDocumentPath(runFolder, fileName, config);
    await openInObsidian(config, filePath);
  });

  ipcMain.handle("runs:open-in-finder", async (_e, runFolder: string) => {
    const config = loadConfig();
    const validatedRunFolder = resolveRunFolderPath(runFolder, config);
    shell.showItemInFolder(path.join(validatedRunFolder, "index.md"));
  });

  ipcMain.handle("runs:delete", async (_e, runFolder: string) => {
    // Always clean DB entry, even if folder is already gone
    getStore().deleteRun(runFolder);
    try {
      const config = loadConfig();
      const validatedRunFolder = resolveRunFolderPath(runFolder, config);
      fs.rmSync(validatedRunFolder, { recursive: true, force: true });
    } catch {
      // Folder already gone — DB cleanup was the important part
    }
  });

  ipcMain.handle("runs:bulk-delete", async (_e, runFolders: string[]) => {
    const config = loadConfig();
    const store = getStore();
    const { validatedFolders, dbOnlyFolders } =
      partitionRunFoldersForBulkDelete(runFolders, config);
    store.deleteRuns([...validatedFolders, ...dbOnlyFolders]);
    for (const folder of validatedFolders) {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });

  ipcMain.handle(
    "runs:update-meta",
    async (
      _e,
      req: { runFolder: string; title?: string; description?: string | null }
    ) => {
      const config = loadConfig();
      const validatedRunFolder = resolveRunFolderPath(req.runFolder, config);
      const store = getStore();
      const manifest = store.loadManifest(validatedRunFolder);
      const updates: Partial<RunManifest> = {};
      if (typeof req.title === "string" && req.title.trim()) {
        updates.title = req.title.trim();
      }
      if ("description" in req) {
        updates.description = req.description && req.description.trim() ? req.description.trim() : null;
      }
      store.updateStatus(validatedRunFolder, manifest.status, updates);
    }
  );

  // ---- draft / prep ----

  ipcMain.handle("runs:create-draft", async (_e, req: CreateDraftRequest) => {
    const config = loadConfig();
    const context = createDraftRun(
      config,
      req.title,
      req.description ?? null,
      { scheduledTime: req.scheduledTime ?? null, quiet: true }
    );
    try {
      getStore().insertRun(context.manifest, context.folderPath);
    } catch (err) {
      // Insert failure is the documented "drafts appear then vanish" path.
      // Log the error so future occurrences are visible instead of silent,
      // and surface it to the renderer so the UI can react rather than
      // showing a ghost card.
      const detail = err instanceof Error ? err.message : String(err);
      appLogger.error("runs:create-draft insertRun failed", {
        runId: context.manifest.run_id,
        runFolder: context.folderPath,
        detail,
      });
      throw err;
    }
    appLogger.info("Draft created", {
      runId: context.manifest.run_id,
      runFolder: context.folderPath,
    });
    return { run_folder: context.folderPath, run_id: context.manifest.run_id };
  });

  ipcMain.handle("runs:write-prep", async (_e, runFolder: string, content: string) => {
    const config = loadConfig();
    const validatedRunFolder = resolveRunFolderPath(runFolder, config);
    fs.writeFileSync(path.join(validatedRunFolder, RUN_PREP_FILE), content, "utf-8");
  });

  ipcMain.handle("runs:read-prep", async (_e, runFolder: string) => {
    const config = loadConfig();
    const validatedRunFolder = resolveRunFolderPath(runFolder, config);
    const prepPath = path.join(validatedRunFolder, RUN_PREP_FILE);
    try {
      return await fs.promises.readFile(prepPath, "utf-8");
    } catch (err: any) {
      if (err.code === "ENOENT") return "";
      throw err;
    }
  });

  ipcMain.handle(
    "runs:add-attachment",
    async (_e, runFolder: string): Promise<AddAttachmentResult | null> => {
      const config = loadConfig();
      const validatedRunFolder = resolveRunFolderPath(runFolder, config);
      const attachDir = path.join(validatedRunFolder, RUN_ATTACHMENTS_DIR);
      fs.mkdirSync(attachDir, { recursive: true });

      const result = await dialog.showOpenDialog({
        title: "Add attachment",
        properties: ["openFile"],
        filters: [
          { name: "Documents", extensions: ["pdf", "docx", "doc", "txt", "md", "rtf"] },
          { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] },
          { name: "Spreadsheets", extensions: ["csv", "xlsx", "xls"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) return null;

      const srcPath = result.filePaths[0];
      const fileName = path.basename(srcPath);
      const destPath = path.join(attachDir, fileName);
      fs.copyFileSync(srcPath, destPath);
      const stat = fs.statSync(destPath);

      // Update manifest attachments list
      const store = getStore();
      const manifest = store.loadManifest(validatedRunFolder);
      if (!manifest.attachments.includes(fileName)) {
        manifest.attachments.push(fileName);
        store.updateStatus(validatedRunFolder, manifest.status, { attachments: manifest.attachments });
      }

      return { fileName, size: stat.size };
    }
  );

  ipcMain.handle("runs:remove-attachment", async (_e, runFolder: string, fileName: string) => {
    const config = loadConfig();
    const filePath = resolveRunAttachmentPath(runFolder, fileName, config);
    fs.rmSync(filePath, { force: true });

    // Update manifest
    const validatedRunFolder = resolveRunFolderPath(runFolder, config);
    const store = getStore();
    const manifest = store.loadManifest(validatedRunFolder);
    manifest.attachments = manifest.attachments.filter((n) => n !== fileName);
    store.updateStatus(validatedRunFolder, manifest.status, { attachments: manifest.attachments });
  });

  ipcMain.handle(
    "runs:list-attachments",
    async (_e, runFolder: string): Promise<Array<{ name: string; size: number }>> => {
      try {
        const config = loadConfig();
        const validatedRunFolder = resolveRunFolderPath(runFolder, config);
        const attachDir = path.join(validatedRunFolder, RUN_ATTACHMENTS_DIR);
        if (!fs.existsSync(attachDir)) return [];
        return fs
          .readdirSync(attachDir, { withFileTypes: true })
          .filter((e) => e.isFile() && !e.name.startsWith("."))
          .map((e) => {
            const stat = fs.statSync(path.join(attachDir, e.name));
            return { name: e.name, size: stat.size };
          });
      } catch {
        // Folder may have been deleted — return empty gracefully
        return [];
      }
    }
  );

  ipcMain.handle("runs:update-prep", async (_e, req: UpdatePrepRequest) => {
    const config = loadConfig();
    const validatedRunFolder = resolveRunFolderPath(req.runFolder, config);
    const store = getStore();
    const manifest = store.loadManifest(validatedRunFolder);
    const updates: Partial<RunManifest> = {};
    if ("selectedPrompts" in req) {
      updates.selected_prompts = req.selectedPrompts ?? null;
    }
    if ("scheduledTime" in req) {
      updates.scheduled_time = req.scheduledTime ?? null;
    }
    store.updateStatus(validatedRunFolder, manifest.status, updates);
  });

  ipcMain.handle("runs:reopen-as-draft", async (_e, runFolder: string) => {
    const config = loadConfig();
    const validatedRunFolder = resolveRunFolderPath(runFolder, config);
    getStore().updateStatus(validatedRunFolder, "draft");
  });

  ipcMain.handle("runs:mark-complete", async (_e, runFolder: string) => {
    const config = loadConfig();
    const validatedRunFolder = resolveRunFolderPath(runFolder, config);
    getStore().updateStatus(validatedRunFolder, "complete");
  });

  // ---- prompts ----
  function assertValidPromptId(id: unknown): asserts id is string {
    if (
      typeof id !== "string" ||
      !id ||
      id.includes("/") ||
      id.includes("\\") ||
      id.includes("..")
    ) {
      throw new Error(`Invalid prompt id: ${String(id)}`);
    }
  }
  function assertValidPromptFilename(filename: unknown): asserts filename is string {
    if (!isAllowedPromptOutputFilename(filename)) {
      throw new Error(`Invalid prompt filename: ${String(filename)}`);
    }
  }

  ipcMain.handle("prompts:list", async (): Promise<PromptRow[]> => {
    const config = safeLoadConfig();
    const all = loadAllPrompts(config ?? undefined);
    return all.map((p) => ({
      id: p.id,
      label: p.label,
      description: p.description,
      sort_order: p.sortOrder,
      filename: p.filename,
      enabled: p.enabled,
      auto: p.auto,
      builtin: p.builtin,
      model: p.model,
      temperature: p.temperature,
      source_path: p.sourcePath,
      body: p.prompt,
    }));
  });

  ipcMain.handle(
    "prompts:save",
    async (_e, id: string, body: string, patch: Partial<PromptRow>) => {
      // Cheap local validations first — bad input fails before we spin up Ollama.
      if ("filename" in patch) assertValidPromptFilename(patch.filename);
      const config = safeLoadConfig();
      const all = loadAllPrompts(config ?? undefined);
      const existing = all.find((p) => p.id === id);
      if (!existing) throw new Error(`Prompt not found: ${id}`);
      const requestedModel = "model" in patch ? patch.model ?? null : existing.model;
      const ollamaState =
        requestedModel && !requestedModel.startsWith("claude-")
          ? ((await ensureOllamaDaemon().catch(() => getOllamaState())) ?? null)
          : null;
      const installedLocalModels = ollamaState
        ? (await listOllamaModels(ollamaState.baseUrl)).map((tag) => tag.name)
        : undefined;
      const nextModel = await validatePromptModelSelection(requestedModel, {
        baseUrl: ollamaState?.baseUrl,
        installedLocalModels,
      });
      // Merge body first.
      const raw = fs.readFileSync(existing.sourcePath, "utf-8");
      const parsed = matter(raw);
      const mergedFrontmatter: Record<string, unknown> = {
        ...parsed.data,
        ...("label" in patch ? { label: patch.label } : {}),
        ...("description" in patch ? { description: patch.description } : {}),
        ...("sort_order" in patch ? { sort_order: patch.sort_order } : {}),
        ...("filename" in patch ? { filename: patch.filename } : {}),
        ...("enabled" in patch ? { enabled: patch.enabled } : {}),
        ...("auto" in patch ? { auto: patch.auto } : {}),
      };
      if ("model" in patch) {
        // Empty string / null means "fall back to the default in Settings",
        // which we represent on disk by deleting the key entirely so the
        // frontmatter stays clean.
        if (nextModel) {
          mergedFrontmatter.model = nextModel;
        } else {
          delete mergedFrontmatter.model;
        }
      }
      if ("temperature" in patch) {
        if (patch.temperature != null) {
          mergedFrontmatter.temperature = patch.temperature;
        } else {
          delete mergedFrontmatter.temperature;
        }
      }
      const rewritten = matter.stringify(`\n${body.trim()}\n`, mergedFrontmatter);
      fs.writeFileSync(existing.sourcePath, rewritten, "utf-8");
    }
  );

  ipcMain.handle(
    "prompts:create",
    async (_e, id: string, label: string, filename: string, body: string) => {
      assertValidPromptId(id);
      assertValidPromptFilename(filename);
      const dir = getPromptsDir();
      fs.mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, `${id}.md`);
      if (fs.existsSync(dest)) {
        throw new Error(`Prompt "${id}" already exists.`);
      }
      const frontmatter = { id, label, filename, enabled: true, auto: false };
      fs.writeFileSync(
        dest,
        matter.stringify(`\n${body.trim() || "Describe what this prompt should produce."}\n`, frontmatter),
        "utf-8"
      );
    }
  );

  ipcMain.handle("prompts:enable", async (_e, id: string, enabled: boolean) => {
    const config = safeLoadConfig();
    updatePromptFrontmatter(config ?? undefined, id, { enabled });
  });

  ipcMain.handle("prompts:set-auto", async (_e, id: string, auto: boolean) => {
    const config = safeLoadConfig();
    updatePromptFrontmatter(config ?? undefined, id, {
      auto,
      enabled: auto,
    });
  });

  ipcMain.handle("prompts:delete", async (_e, id: string) => {
    if (typeof id !== "string" || !id || id.includes("/") || id.includes("\\") || id.includes("..")) {
      throw new Error(`Invalid prompt id: ${id}`);
    }
    const config = safeLoadConfig();
    const all = loadAllPrompts(config ?? undefined);
    const existing = all.find((p) => p.id === id);
    if (!existing) throw new Error(`Prompt not found: ${id}`);
    if (existing.builtin) {
      throw new Error(`Cannot delete built-in prompt "${id}". Use Reset to default instead.`);
    }
    const dir = getPromptsDir();
    const expected = path.resolve(dir, `${id}.md`);
    const actual = path.resolve(existing.sourcePath);
    if (actual !== expected) {
      throw new Error(`Prompt "${id}" is not managed by the prompts directory.`);
    }
    fs.rmSync(actual, { force: true });
  });

  ipcMain.handle("prompts:reset-to-default", async (_e, id?: string) => {
    const dir = getPromptsDir();
    const fileName = id ? `${id}.md` : undefined;
    if (fileName) {
      const src = path.join(DEFAULT_PROMPTS_DIR, fileName);
      if (!fs.existsSync(src)) throw new Error(`No builtin named "${id}".`);
    }
    resetDefaultPrompts(dir, fileName);
  });

  ipcMain.handle("prompts:get-dir", async () => getPromptsDir());

  ipcMain.handle("prompts:open-in-finder", async (_e, promptId?: string) => {
    const dir = getPromptsDir();
    if (promptId) {
      const filePath = path.join(dir, `${promptId}.md`);
      shell.showItemInFolder(filePath);
    } else {
      shell.showItemInFolder(dir);
    }
  });

  // ---- secrets ----
  ipcMain.handle("secrets:has", async (_e, name: "claude" | "openai") => {
    return hasSecret(name);
  });

  ipcMain.handle("secrets:set", async (_e, name: "claude" | "openai", value: string) => {
    await setSecret(name, value);
  });

  // ---- setup-asr ----
  ipcMain.handle("setup-asr", async (_e, opts: { force?: boolean }) => {
    await setupAsr({
      force: opts.force,
      onLog: (line) => broadcastToAll("setup-asr:log", line),
    });
  });

  // ---- dep install (direct download + verify, no Homebrew) ----
  //
  // Replaces the prior brew wrapper. The wizard buttons call here for
  // ffmpeg / ollama / whisper-cli; we look up the manifest entry,
  // stream the URL through hash + signature + verify-exec checks, and
  // atomic-rename into <userData>/bin. No Terminal, no Homebrew,
  // no interactive sudo.
  //
  // `deps:check-brew` stays as a stub returning true so the existing
  // wizard renderer doesn't show the "Homebrew not installed" card.
  // Phase 3's wizard rewrite removes both this stub and the renderer
  // call site entirely.
  ipcMain.handle("deps:check-brew", async (): Promise<boolean> => {
    return true;
  });

  ipcMain.handle(
    "deps:install",
    async (_e, target: DepsInstallTarget): Promise<DepsInstallResult> => {
      broadcastToAll("deps-install:log", `→ installing ${target}`);

      const result = await installTool({
        tool: target,
        onProgress: (event: InstallerProgressEvent) => {
          // Stream progress to two channels:
          //  - installer-progress: structured payload (Phase 3 wizard
          //    surfaces bytesDone/bytesTotal in a progress bar)
          //  - deps-install:log: human-readable line stream (wizard
          //    log panel — same UX as the brew wrapper used to drive)
          broadcastToAll("installer-progress", event);
          if (event.phase === "download" && event.bytesDone !== undefined) {
            const total = event.bytesTotal
              ? ` / ${humanBytes(event.bytesTotal)}`
              : "";
            broadcastToAll(
              "deps-install:log",
              `  ${event.phase}: ${humanBytes(event.bytesDone)}${total}`
            );
          } else if (event.phase === "failed") {
            broadcastToAll(
              "deps-install:log",
              `✘ ${target} install failed: ${event.error ?? "unknown"}`
            );
          } else {
            broadcastToAll("deps-install:log", `  ${event.phase}…`);
          }
        },
      });

      if (result.ok) {
        broadcastToAll("deps-install:log", `✓ ${target} installed`);
        createAppLogger(false).info("Dependency install completed", {
          processType: "wizard-install",
          detail: target,
        });
        return { ok: true };
      }
      createAppLogger(false).error("Dependency install failed", {
        processType: "wizard-install",
        detail: target,
        message: result.error,
      });
      return { ok: false, error: result.error, failedPhase: result.phase };
    }
  );

  // ---- electron-updater ----
  //
  // All four handlers below are always registered. When UPDATER_ENABLED
  // is false (no real publish target in build-flags.ts), each returns
  // an inert `{ enabled: false, kind: "disabled-at-build" }` status —
  // the renderer reads `enabled` once on startup and hides the entire
  // UI surface. Keeping the handlers registered (rather than skipping
  // them) means preload/renderer skew can never crash with "no handler
  // registered for channel updater:check".
  ipcMain.handle("updater:get-status", async () => getUpdaterStatus());
  ipcMain.handle("updater:check", async () => await checkForUpdates());
  ipcMain.handle("updater:download", async () => await startDownload());
  ipcMain.handle("updater:install", async () => await installAndRestart());
  ipcMain.handle("updater:get-prefs", async () => loadUpdaterPrefs());
  ipcMain.handle("updater:set-prefs", async (_e, prefs: UpdaterPreferences) => {
    saveUpdaterPrefs(prefs);
    const updated = loadUpdaterPrefs();
    // Nudge subscribers (UpdaterBanner, Settings → Updates panel) so
    // they re-fetch prefs and re-render. The status payload itself is
    // unchanged — what matters is the event firing.
    //
    // Without this broadcast, flipping "Show a banner…" off in Settings
    // wouldn't hide an already-visible banner until some unrelated
    // updater status event happened to fire — a real production bug
    // hidden by mock-only test coverage. The Playwright mock-api
    // (playwright/mock-api.ts) already broadcasts on setPrefs; this
    // line keeps the production path in sync.
    broadcastToAll("updater:status", getUpdaterStatus());
    return updated;
  });

  // Dev simulator — only registered when not packaged. Production
  // builds will respond with "simulated-install-blocked"-shaped object
  // if a renderer somehow invokes it (defensive, shouldn't happen).
  if (!app.isPackaged) {
    ipcMain.handle(
      "updater:simulate",
      async (
        _e,
        action: UpdaterSimulatorAction,
        payload?: { version?: string; message?: string }
      ) => {
        return dispatchSimulator(action, payload);
      }
    );
  } else {
    ipcMain.handle("updater:simulate", async () => ({
      enabled: updaterEnabled,
      kind: "disabled-at-build" as const,
    }));
  }

  // ---- support: feedback mailto + reveal logs ----
  ipcMain.handle("support:open-feedback-mail", async () => {
    await openFeedbackMail();
  });
  ipcMain.handle("support:reveal-logs", async () => {
    await revealLogsInFinder();
  });
  ipcMain.handle("support:open-licenses", async () => {
    await openLicensesFile();
  });

  // ---- Obsidian vault detection ----
  //
  // Quick-pick helper for step 1 of the wizard: scan the usual suspects
  // (~/Obsidian/*, ~/Documents/*) one level deep for directories that
  // contain a `.obsidian/` subfolder (Obsidian's marker file). Cheap
  // enough to run on every wizard mount — we stat at most a few dozen
  // dirs.
  ipcMain.handle("obsidian:detect-vaults", async (): Promise<DetectedVault[]> => {
    const home = os.homedir();
    const scanRoots = [
      path.join(home, "Obsidian"),
      path.join(home, "Documents"),
    ];
    const found: DetectedVault[] = [];
    const seen = new Set<string>();
    for (const root of scanRoots) {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(root, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const vaultPath = path.join(root, entry.name);
        if (seen.has(vaultPath)) continue;
        const marker = path.join(vaultPath, ".obsidian");
        try {
          const st = fs.statSync(marker);
          if (st.isDirectory()) {
            found.push({ path: vaultPath, name: entry.name });
            seen.add(vaultPath);
          }
        } catch {
          // not a vault
        }
      }
    }
    return found;
  });

  // ---- Integrations (Settings → Integrations) ----

  ipcMain.handle("integrations:get-mcp-status", async () => {
    return getMcpStatus();
  });

  ipcMain.handle("integrations:install-mcp-claude", async () => {
    return installMcpForClaude();
  });

  ipcMain.handle("integrations:uninstall-mcp-claude", async () => {
    return uninstallMcpForClaude();
  });

  // ---- Chat Launcher ----

  const CHAT_APPS: { id: "chatgpt" | "claude" | "ollama"; label: string; appName: string }[] = [
    { id: "chatgpt", label: "ChatGPT", appName: "ChatGPT" },
    { id: "claude", label: "Claude", appName: "Claude" },
    { id: "ollama", label: "Ollama", appName: "Ollama" },
  ];

  ipcMain.handle("chatLauncher:detect-apps", async (): Promise<ChatAppInfo[]> => {
    const home = os.homedir();
    const results: ChatAppInfo[] = [];
    for (const app of CHAT_APPS) {
      const installed =
        fs.existsSync(`/Applications/${app.appName}.app`) ||
        fs.existsSync(path.join(home, "Applications", `${app.appName}.app`));
      results.push({ id: app.id, label: app.label, installed });
    }
    results.push({ id: "custom", label: "Custom", installed: true });
    return results;
  });

  ipcMain.handle(
    "chatLauncher:launch",
    async (_e, req: LaunchChatRequest): Promise<LaunchChatResult> => {
      const config = loadConfig();
      const runFolder = resolveRunFolderPath(req.runFolder, config);

      // Read and assemble selected files
      const parts: string[] = [];
      if (req.startingPrompt.trim()) {
        parts.push(req.startingPrompt.trim());
      }
      for (const fileName of req.fileNames) {
        const filePath = resolveRunDocumentPath(runFolder, fileName, config);
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          parts.push(`---\n## ${fileName}\n\n${content}`);
        } catch {
          parts.push(`---\n## ${fileName}\n\n_(file not found)_`);
        }
      }

      const assembled = parts.join("\n\n");
      clipboard.writeText(assembled);

      // Determine app name to launch
      let appName: string;
      if (req.appId === "custom") {
        if (!req.customAppName?.trim()) {
          return { ok: false, error: "No app name provided." };
        }
        appName = req.customAppName.trim();
      } else {
        const entry = CHAT_APPS.find((a) => a.id === req.appId);
        if (!entry) {
          return { ok: false, error: `Unknown app: ${req.appId}` };
        }
        appName = entry.appName;
      }

      try {
        await execFileAsync("/usr/bin/open", ["-a", appName]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error: `Could not launch ${appName}. Is it installed?\n${msg}`,
          charsCopied: assembled.length,
        };
      }

      return { ok: true, charsCopied: assembled.length };
    }
  );

  // ---- logs ----
  ipcMain.handle("logs:tail-app", async (_e, lines: number) => {
    return tailFile(getAppLogPath(), lines);
  });

  ipcMain.handle("logs:tail-run", async (_e, runFolder: string, lines: number) => {
    const config = loadConfig();
    const logPath = resolveRunDocumentPath(runFolder, RUN_LOG_FILE, config);
    return tailFile(logPath, lines);
  });

  ipcMain.handle("logs:app-path", async () => getAppLogPath());
  ipcMain.handle("logs:list-app-entries", async (_e, query?: AppLogQuery) => {
    return listAppEntries(query);
  });
  ipcMain.handle("logs:list-processes", async () => {
    return listProcesses();
  });
  ipcMain.handle("logs:reveal-app", async () => {
    revealLogFile(getAppLogPath());
  });
  ipcMain.handle("logs:reveal-ollama", async () => {
    revealLogFile(path.join(getConfigDir(), "ollama.log"));
  });
  ipcMain.handle("logs:renderer-error", async (_e, payload: {
    source: string;
    message: string;
    stack?: string;
    href?: string;
    userAgent?: string;
    detail?: string;
  }) => {
    try {
      createAppLogger(false).error(`Renderer ${payload.source}`, {
        message: payload.message,
        stack: payload.stack,
        href: payload.href,
        userAgent: payload.userAgent,
        detail: payload.detail,
      });
    } catch {
      // Best effort only. Renderer must not crash because logging failed.
    }
  });

  ipcMain.handle("jobs:list", async (): Promise<JobSummary[]> => {
    return listJobs();
  });

  ipcMain.handle("jobs:cancel", async (_e, jobId: string) => {
    cancelJob(jobId);
  });

  ipcMain.handle("jobs:tail-log", async (_e, jobId: string, lines: number) => {
    return getJobLog(jobId, lines, tailFile);
  });

  // ---- deps check ----
  ipcMain.handle("deps:check", async (): Promise<DepsCheckResult> => {
    // ffmpeg — resolved app-installed → bundled → system. Source is
    // surfaced so the wizard can show "App copy" vs "System: …" badges.
    const ffmpegBin = await resolveBin("ffmpeg");
    let ffmpegVersion: string | null = null;
    if (ffmpegBin) {
      try {
        const { stdout } = await execFileAsync(ffmpegBin.path, ["-version"]);
        const m = stdout.match(/ffmpeg version (\S+)/);
        if (m) ffmpegVersion = m[1];
      } catch { /* ignore */ }
    }
    const ffmpeg: ResolvedTool = {
      path: ffmpegBin?.path ?? null,
      source: ffmpegBin?.source ?? null,
      version: ffmpegVersion,
    };

    // Python — system-only. We never install Python ourselves.
    const pythonPath =
      (await whichCmd("python3.12")) ??
      (await whichCmd("python3.11")) ??
      (await whichCmd("python3"));
    let pythonVersion: string | null = null;
    if (pythonPath) {
      try {
        const { stdout } = await execFileAsync(pythonPath, ["--version"]);
        const m = stdout.match(/Python (\S+)/);
        if (m) pythonVersion = m[1];
      } catch { /* ignore */ }
    }
    const python: ResolvedTool = {
      path: pythonPath,
      source: pythonPath ? "system" : null,
      version: pythonVersion,
    };

    // System audio: check macOS version for AudioTee support (14.2+).
    const systemAudioSupported = isSystemAudioSupported();

    // Parakeet: check the default install path rather than the configured path,
    // because during the Setup Wizard the user hasn't written a config yet and
    // safeLoadConfig() returns null. This default matches DEFAULT_CONFIG in
    // engine/core/config.ts — if either changes, this check needs to move.
    const parakeetBinPath = path.join(
      os.homedir(),
      ".gistlist",
      "parakeet-venv",
      "bin",
      "mlx_audio.stt.generate"
    );
    let parakeetPath: string | null = null;
    try {
      const st = fs.statSync(parakeetBinPath);
      // Executable bit check — if the file is there but not executable the
      // venv is broken and we should offer to reinstall.
      if (st.isFile() && (st.mode & 0o111) !== 0) {
        parakeetPath = parakeetBinPath;
      }
    } catch {
      parakeetPath = null;
    }
    // Parakeet always lives under ~/.gistlist/parakeet-venv when present —
    // it's app-managed, not bundled and not on PATH. We tag it as
    // "app-installed" to match other wizard-managed tools.
    const parakeet: ResolvedTool = {
      path: parakeetPath,
      source: parakeetPath ? "app-installed" : null,
      version: null,
    };

    // whisper-cli — resolved app-installed → bundled → system PATH.
    const whisperBin = await resolveBin("whisper-cli");
    const whisper: ResolvedTool = {
      path: whisperBin?.path ?? null,
      source: whisperBin?.source ?? null,
      version: null,
    };

    // Ollama: ask the daemon module what state it's in (or attempt to ping a
    // pre-existing system daemon if we haven't started ours yet). We don't
    // spawn from inside deps:check — that's app-startup's job — so a fully
    // cloud-only user never pays the cost.
    let ollamaDaemonUp = false;
    let ollamaSource: DepsCheckResult["ollama"]["source"] | undefined;
    let installedModels: string[] = [];
    try {
      const state = getOllamaState();
      if (state) {
        ollamaSource = state.source;
        const status = await checkOllama(state.baseUrl);
        ollamaDaemonUp = status.daemon;
        installedModels = status.installedModels;
      } else {
        const status = await checkOllama();
        ollamaDaemonUp = status.daemon;
        installedModels = status.installedModels;
        if (ollamaDaemonUp) ollamaSource = "system-running";
      }
    } catch {
      ollamaDaemonUp = false;
    }
    let ollamaVersion: string | null = null;
    if (ollamaDaemonUp) {
      try {
        const ollamaBin = await whichCmd("ollama");
        if (ollamaBin) {
          const { stdout } = await execFileAsync(ollamaBin, ["--version"]);
          const m = stdout.match(/(\d+\.\d+\S*)/);
          if (m) ollamaVersion = m[1];
        }
      } catch { /* ignore */ }
    }
    return {
      ffmpeg,
      python,
      blackhole: "missing" as const,
      systemAudioSupported,
      parakeet,
      whisper,
      ollama: {
        daemon: ollamaDaemonUp,
        source: ollamaSource,
        installedModels,
        version: ollamaVersion,
      },
    };
  });

  // ---- llm (Ollama) ----
  ipcMain.handle("llm:check", async (): Promise<DepsCheckResult["ollama"]> => {
    try {
      // Spinning up the daemon here means the wizard's "check" call is also
      // what brings Ollama online for the first time — saves a separate
      // "start daemon" UI step.
      const state = await ensureOllamaDaemon();
      const status = await checkOllama(state.baseUrl);
      return {
        daemon: status.daemon,
        source: state.source,
        installedModels: status.installedModels,
      };
    } catch {
      return { daemon: false, installedModels: [] };
    }
  });

  ipcMain.handle(
    "llm:setup",
    async (_e, opts: { model: string; force?: boolean }) => {
      // Make sure the daemon is up first; setupLlm pings but won't spawn.
      const state = await ensureOllamaDaemon();
      await setupLlm({
        model: opts.model,
        baseUrl: state.baseUrl,
        force: opts.force,
        onLog: (line) => broadcastToAll("setup-llm:log", line),
        onProgress: (p) => broadcastToAll("setup-llm:progress", p),
      });
    }
  );

  ipcMain.handle("llm:list-installed", async (): Promise<string[]> => {
    try {
      const state = (await ensureOllamaDaemon().catch(() => getOllamaState())) ?? null;
      const baseUrl = state?.baseUrl;
      const tags = await listOllamaModels(baseUrl);
      return tags.map((t) => t.name);
    } catch {
      return [];
    }
  });

  ipcMain.handle("llm:remove", async (_e, model: string) => {
    const state = getOllamaState();
    await deleteOllamaModel(model, state?.baseUrl);
  });

  ipcMain.handle("llm:runtime", async (): Promise<OllamaRuntimeDTO> => {
    try {
      const state = getOllamaState() ?? await ensureOllamaDaemon();
      const models = await listRunningOllamaModels(state.baseUrl);
      const ollamaVramBytes = models.reduce((sum, m) => sum + (m.size_vram ?? 0), 0);
      return {
        available: true,
        source: state.source,
        models: models.map((model) => ({
          model: model.model,
          name: model.name,
          size: model.size,
          size_vram: model.size_vram,
          expires_at: model.expires_at,
          details: model.details
            ? {
                parameter_size: model.details.parameter_size,
                quantization_level: model.details.quantization_level,
                family: model.details.family,
                format: model.details.format,
              }
            : undefined,
        })),
        systemMemory: {
          totalBytes: os.totalmem(),
          freeBytes: os.freemem(),
          ollamaVramBytes,
        },
      };
    } catch (err) {
      return {
        available: false,
        models: [],
        error: err instanceof Error ? err.message : String(err),
        systemMemory: {
          totalBytes: os.totalmem(),
          freeBytes: os.freemem(),
          ollamaVramBytes: 0,
        },
      };
    }
  });

  // ---- system ----
  ipcMain.handle("system:detect-hardware", async () => {
    return detectHardware();
  });

  // ---- meeting index (FTS + sqlite-vec corpus the MCP server reads) ----
  registerMeetingIndexIpc();

  // Create an app logger on first registration — gives us structured
  // startup logs in ~/.gistlist/app.log.
  try {
    createAppLogger(false).info("Electron IPC handlers registered");
  } catch {
    // No config dir yet — harmless.
  }
}

function tailFile(filePath: string, lines: number): string {
  if (!fs.existsSync(filePath)) return "";
  const content = fs.readFileSync(filePath, "utf-8");
  const all = content.split(/\r?\n/);
  return all.slice(Math.max(0, all.length - lines)).join("\n");
}

// Reveal a log file in Finder. Falls back to opening the config dir
// when the exact file does not exist yet (fresh install, or daemon
// hasn't written ollama.log) — silently no-oping would be confusing.
function revealLogFile(filePath: string): void {
  if (fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return;
  }
  shell.openPath(getConfigDir());
}

async function whichCmd(cmd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("/usr/bin/env", ["which", cmd]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Render a byte count for human-readable progress logs. */
function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
