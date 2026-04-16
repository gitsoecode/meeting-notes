import fs from "node:fs";
import path from "node:path";
import {
  FfmpegRecorder,
  OperationAbortedError,
  loadConfig,
  createRun,
  processRun,
  updateRunStatus,
  loadRunManifest,
  formatAudioSegmentName,
  migrateFlatLayoutToSegment,
  saveActiveRecording,
  loadActiveRecording,
  clearActiveRecording,
  openInObsidian,
  createRunLogger,
  createAppLogger,
  checkAudioSilence,
  type RecordingSession,
  type AppConfig,
  type Logger,
  type PipelineProgressEvent,
} from "@meeting-notes/engine";
import type { RecordingStatus } from "../shared/ipc.js";
import { buildInterruptedRunUpdate } from "./recording-lifecycle.js";
import {
  validateStartRecording,
  validateStartForDraft,
  validatePause,
  validateResume,
  validateContinue,
  resolveStopTarget,
  type RecordingModuleState,
} from "./recording-state.js";
import { finishTrackedProcess, startTrackedProcess } from "./activity-monitor.js";
import { scheduleJob } from "./jobs.js";
import { resolveRunFolderPath } from "./run-access.js";
import { getCachedAudioDevices } from "./device-cache.js";
import { stopAudioMonitor } from "./audio-monitor.js";
import { resolveAudioTeeBinary } from "./audiotee-binary.js";
import { resolveMicCaptureBinary } from "./mic-capture-binary.js";
import { getStore } from "./store.js";
import { collectRunAudioFiles } from "./runs-service.js";

export interface ActiveRecordingState {
  session: RecordingSession;
  runFolder: string;
  runId: string;
  title: string;
  startedAt: string;
  logger: Logger;
  config: AppConfig;
  micPath?: string;
  systemPath?: string;
  systemCaptured: boolean;
  /** Visible warning about system audio issues (permission denied, silent, etc.) */
  systemAudioWarning?: string;
  processIds: string[];
}

let active: ActiveRecordingState | null = null;
/** Tracks a paused run so resume can pick it back up. */
let pausedRunFolder: string | null = null;
const appLogger = createAppLogger(Boolean(process.env.VITE_DEV_SERVER_URL));

function currentState(): RecordingModuleState {
  return { hasActiveSession: active !== null, hasPausedRun: pausedRunFolder !== null };
}

function isAbortLikeError(err: unknown): boolean {
  return err instanceof OperationAbortedError || (err instanceof Error && err.name === "AbortError");
}

/**
 * Persist the just-stopped session's capture metadata next to its audio
 * files in `audio/<segment>/capture-meta.json`. With pause/resume producing
 * multiple segments per run, a single root-level sidecar would only
 * describe the last session — downstream drift correction and AEC alignment
 * would silently use wrong offsets for every earlier segment.
 */
function writeSegmentCaptureMeta(state: ActiveRecordingState): void {
  if (!state.session.captureMeta) return;
  const segmentDir = state.micPath ? path.dirname(state.micPath) : null;
  if (!segmentDir) return;
  try {
    fs.mkdirSync(segmentDir, { recursive: true });
    fs.writeFileSync(
      path.join(segmentDir, "capture-meta.json"),
      JSON.stringify(state.session.captureMeta, null, 2)
    );
  } catch (err) {
    state.logger.warn("Failed to write capture-meta.json", {
      segmentDir,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function isRecording(): boolean {
  return active !== null;
}

export function isPaused(): boolean {
  return pausedRunFolder !== null;
}

export function getPausedRunFolder(): string | null {
  return pausedRunFolder;
}

export function getActiveState(): ActiveRecordingState | null {
  return active;
}

export async function getStatus(): Promise<RecordingStatus> {
  if (active) {
    return {
      active: true,
      paused: false,
      run_id: active.runId,
      title: active.title,
      started_at: active.startedAt,
      run_folder: active.runFolder,
      system_captured: active.systemCaptured,
      system_audio_warning: active.systemAudioWarning,
    };
  }
  if (pausedRunFolder) {
    try {
      const manifest = loadRunManifest(pausedRunFolder);
      return {
        active: true,
        paused: true,
        run_id: manifest.run_id,
        title: manifest.title,
        started_at: manifest.started,
        run_folder: pausedRunFolder,
        system_captured: false,
      };
    } catch {
      pausedRunFolder = null;
    }
  }
  // Also surface a CLI-started recording (the CLI writes active-recording.json too).
  const cli = loadActiveRecording();
  if (cli && cli.pids.some((pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  })) {
    return {
      active: true,
      run_id: cli.run_id,
      title: cli.title,
      started_at: cli.started_at,
      run_folder: cli.run_folder,
      system_captured: cli.system_captured,
    };
  }
  return { active: false };
}

export async function startRecording(
  title: string,
  description: string | null = null
): Promise<{ run_folder: string; run_id: string }> {
  validateStartRecording(currentState());
  const config = loadConfig();
  const runContext = createRun(config, title, { sourceMode: "both", quiet: true }, description);
  const { folderPath, manifest, logger } = runContext;
  try {
    getStore().insertRun(manifest, folderPath);
  } catch (err: unknown) {
    // Clean up the folder that createRun already wrote to disk.
    fs.rmSync(folderPath, { recursive: true, force: true });
    throw err;
  }

  try {
    active = await startCaptureIntoSegment(
      config,
      folderPath,
      manifest.run_id,
      title,
      manifest.started,
      logger
    );
  } catch (err) {
    fs.rmSync(folderPath, { recursive: true, force: true });
    getStore().deleteRun(folderPath);
    throw err;
  }

  appLogger.info("Recording started", {
    runId: manifest.run_id,
    runFolder: folderPath,
    processType: "ffmpeg",
    detail: active.systemCaptured ? "mic+system" : "mic-only",
  });

  // Try to open notes.md in Obsidian if the integration is on.
  void openInObsidian(config, path.join(folderPath, "notes.md"));

  return { run_folder: folderPath, run_id: manifest.run_id };
}

export interface StopOptions {
  mode?: "process" | "save" | "delete";
  onProgress?: (runFolder: string, event: PipelineProgressEvent) => void;
}

export async function stopRecording(
  opts: StopOptions = {}
): Promise<{ run_folder?: string; deleted?: boolean } | null> {
  const mode = opts.mode ?? "process";
  const target = resolveStopTarget(currentState(), !!loadActiveRecording());

  if (target !== "active") {
    // Handle paused recording — no active ffmpeg session, but run is tracked.
    if (target === "paused" && pausedRunFolder) {
      const config = loadConfig();
      const validated = resolveRunFolderPath(pausedRunFolder, config);
      const folder = pausedRunFolder;
      pausedRunFolder = null;

      if (mode === "delete") {
        fs.rmSync(validated, { recursive: true, force: true });
        getStore().deleteRun(validated);
        return { deleted: true };
      }

      const manifest = loadRunManifest(validated);
      const endedAt = new Date().toISOString();
      const startedMs = Date.parse(manifest.started);
      const endedMs = Date.parse(endedAt);
      updateRunStatus(validated, "complete", {
        ended: endedAt,
        duration_minutes:
          Number.isFinite(startedMs) && Number.isFinite(endedMs) && endedMs > startedMs
            ? (endedMs - startedMs) / 60000
            : null,
      }, getStore());
      return { run_folder: folder };
    }

    // Maybe the CLI has an active recording.
    const cli = target === "cli" ? loadActiveRecording() : null;
    if (cli) {
      // Best-effort: send SIGINT to each pid and clear the state file.
      for (const pid of cli.pids) {
        try {
          process.kill(pid, "SIGINT");
        } catch {
          // Already dead.
        }
      }
      clearActiveRecording();
      if (mode === "delete") {
        const validatedRunFolder = resolveRunFolderPath(cli.run_folder, loadConfig());
        fs.rmSync(validatedRunFolder, { recursive: true, force: true });
        return { deleted: true };
      }
      if (mode === "save") {
        const config = loadConfig();
        const validatedRunFolder = resolveRunFolderPath(cli.run_folder, config);
        const startedMs = Date.parse(cli.started_at);
        const endedAt = new Date().toISOString();
        const endedMs = Date.parse(endedAt);
        updateRunStatus(validatedRunFolder, "complete", {
          ended: endedAt,
          duration_minutes:
            Number.isFinite(startedMs) && Number.isFinite(endedMs) && endedMs > startedMs
              ? (endedMs - startedMs) / 60000
              : null,
        }, getStore());
      }
      return { run_folder: cli.run_folder };
    }
    return null;
  }

  // target === "active" here; the validator guarantees active is non-null.
  const state = active!;
  active = null;

  try {
    await state.session.stop();
  } catch (err) {
    state.logger.warn("Recorder stop threw", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  for (const processId of state.processIds) {
    finishTrackedProcess(processId, { status: "exited" });
  }
  clearActiveRecording();

  if (mode === "delete") {
    const validatedRunFolder = resolveRunFolderPath(state.runFolder, state.config);
    fs.rmSync(validatedRunFolder, { recursive: true, force: true });
    return { deleted: true };
  }

  // Persist this segment's capture metadata into its own directory so
  // per-segment drift/AEC/offset alignment works after pause+resume.
  writeSegmentCaptureMeta(state);

  const manifestAfterStop = loadRunManifest(state.runFolder);
  const audioFiles = collectRunAudioFiles(state.runFolder, manifestAfterStop.source_mode);

  if (audioFiles.length === 0) {
    state.logger.error("No audio files captured, marking run as error");
    updateRunStatus(state.runFolder, "error", { ended: new Date().toISOString() }, getStore());
    appLogger.error("Recording stopped without captured audio", {
      runFolder: state.runFolder,
    });
    return { run_folder: state.runFolder };
  }

  // Best-effort silence check on system audio to warn about routing issues.
  if (state.systemCaptured && state.systemPath) {
    void checkAudioSilence(state.systemPath).then((result) => {
      if (result.isSilent) {
        const msg = "System audio appears to be silent. Check that the System Audio Recording permission is granted in System Settings → Privacy & Security.";
        state.logger.warn(msg, {
          maxVolumeDb: result.maxVolumeDb,
          meanVolumeDb: result.meanVolumeDb,
        });
        appLogger.warn("System audio is silent", {
          runFolder: state.runFolder,
          detail: msg,
        });
      }
    }).catch(() => {});
  }

  // Note: combined.wav generation has moved into the processing job
  // (see packages/engine/src/core/process-run.ts) so it can use the
  // AEC-cleaned mic track. We no longer kick it off fire-and-forget here.

  const endedAt = new Date().toISOString();

  if (mode === "save") {
    const startedMs = Date.parse(state.startedAt);
    const endedMs = Date.parse(endedAt);
    updateRunStatus(state.runFolder, "complete", {
      ended: endedAt,
      duration_minutes:
        Number.isFinite(startedMs) && Number.isFinite(endedMs) && endedMs > startedMs
          ? (endedMs - startedMs) / 60000
          : null,
    }, getStore());
    return { run_folder: state.runFolder };
  }

  // Kick off processing. We don't await completion here for snappiness —
  // the renderer subscribes to pipeline progress events.
  void (async () => {
    try {
      await scheduleJob({
        kind: "process-recording",
        title: state.title,
        subtitle: "Processing captured meeting locally",
        runFolder: state.runFolder,
        provider: state.config.llm_provider,
        model:
          state.config.llm_provider === "ollama"
            ? state.config.ollama.model
            : state.config.claude.model,
        task: async ({ signal, updateProgress }) => {
          const result = await processRun({
            config: state.config,
            runFolder: state.runFolder,
            title: state.title,
            date: state.startedAt.split("T")[0],
            audioFiles,
            logger: state.logger,
            signal,
            onProgress: (event) => {
              updateProgress(event);
              opts.onProgress?.(state.runFolder, event);
            },
          });
          if (result.failed.length > 0) {
            throw new Error(
              `${result.failed.length} prompt output(s) failed: ${result.failed.join(", ")}`
            );
          }
          return result;
        },
      });
    } catch (err) {
      if (!isAbortLikeError(err)) {
        state.logger.error("Auto-processing failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  })();

  return { run_folder: state.runFolder };
}

/** Used during `before-quit` to ensure nothing is left running. */
export async function stopActiveRecording(_reason: string): Promise<void> {
  if (!active) return;
  const state = active;
  try {
    await state.session.stop();
  } catch {
    // Best effort.
  }
  writeSegmentCaptureMeta(state);
  for (const processId of state.processIds) {
    finishTrackedProcess(processId, { status: "failed", error: "Recording interrupted during app quit" });
  }
  if (_reason === "app-quit") {
    const endedAt = new Date().toISOString();
    updateRunStatus(state.runFolder, "aborted", buildInterruptedRunUpdate(state.startedAt, endedAt), getStore());
    state.logger.warn("Recording aborted during app quit", {
      run_folder: state.runFolder,
      endedAt,
    });
    appLogger.warn("Recording aborted during app quit", {
      runFolder: state.runFolder,
      detail: endedAt,
    });
  }
  clearActiveRecording();
  active = null;
}

// ---- Shared helper for starting ffmpeg capture into a segment directory ----

async function startCaptureIntoSegment(
  config: AppConfig,
  runFolder: string,
  runId: string,
  title: string,
  startedAt: string,
  logger: Logger
): Promise<ActiveRecordingState> {
  // Release the live audio meter, if it was running, so the real recording
  // gets exclusive use of the mic/system taps.
  await stopAudioMonitor();

  // Before creating this segment, rescue any pre-fix flat-layout audio
  // (`audio/mic.wav` / `audio/system.wav`) into a back-dated segment
  // directory so the run ends up fully segmented instead of mixed.
  const store = getStore();
  const preMigrationManifest = store.loadManifest(runFolder);
  if (preMigrationManifest.recording_segments.length === 0) {
    const migratedSegment = migrateFlatLayoutToSegment(runFolder, preMigrationManifest.started);
    if (migratedSegment) {
      preMigrationManifest.recording_segments.push(migratedSegment);
      updateRunStatus(runFolder, preMigrationManifest.status, {
        recording_segments: preMigrationManifest.recording_segments,
      }, store);
      logger.info("Migrated legacy flat audio layout into segment", {
        run_folder: runFolder,
        segment: migratedSegment,
      });
    }
  }

  const now = new Date();
  const segmentName = formatAudioSegmentName(now);
  const segmentDir = path.join(runFolder, "audio", segmentName);
  fs.mkdirSync(segmentDir, { recursive: true });

  const recorder = new FfmpegRecorder(logger);
  const devices = await getCachedAudioDevices();
  const session = await recorder.start({
    micDevice: config.recording.mic_device,
    systemDevice: config.recording.system_device,
    outputDir: segmentDir,
    devices,
    audioTeeBinaryPath: resolveAudioTeeBinary(),
    micCaptureBinaryPath: resolveMicCaptureBinary(),
  });

  // Update manifest to add this segment
  const manifest = store.loadManifest(runFolder);
  manifest.recording_segments.push(segmentName);
  updateRunStatus(runFolder, "recording", {
    recording_segments: manifest.recording_segments,
  }, store);

  const systemAudioWarning = session.systemCaptured
    ? undefined
    : "System audio capture is not available. Check that the System Audio Recording permission is granted in System Settings → Privacy & Security.";

  const state: ActiveRecordingState = {
    session,
    runFolder,
    runId,
    title,
    startedAt,
    logger,
    config,
    micPath: session.paths.mic,
    systemPath: session.paths.system,
    systemCaptured: session.systemCaptured,
    systemAudioWarning,
    processIds: [
      startTrackedProcess({
        id: session.pids[0] ? `ffmpeg:${session.pids[0]}` : undefined,
        type: "ffmpeg",
        label: "Microphone capture",
        pid: session.pids[0],
        command: "ffmpeg avfoundation recording",
        runFolder,
        status: "running",
      }),
      ...(session.systemCaptured && session.pids[1]
        ? [
            startTrackedProcess({
              id: `ffmpeg:${session.pids[1]}`,
              type: "ffmpeg",
              label: "System audio capture",
              pid: session.pids[1],
              command: "ffmpeg avfoundation recording",
              runFolder,
              status: "running",
            }),
          ]
        : []),
    ],
  };

  saveActiveRecording({
    run_id: runId,
    run_folder: runFolder,
    title,
    started_at: startedAt,
    pids: session.pids,
    mic_path: session.paths.mic,
    system_path: session.paths.system,
    system_captured: session.systemCaptured,
  });

  logger.info("Capture started", {
    run_id: runId,
    segment: segmentName,
    mic: session.paths.mic,
    system: session.paths.system ?? "(none)",
  });

  return state;
}

// ---- New recording lifecycle functions ----

export async function startRecordingForDraft(
  runFolder: string
): Promise<{ run_folder: string; run_id: string }> {
  const config = loadConfig();
  const validated = resolveRunFolderPath(runFolder, config);
  const manifest = loadRunManifest(validated);
  validateStartForDraft(currentState(), manifest.status);

  const startedAt = manifest.status === "recording" && manifest.started
    ? manifest.started
    : new Date().toISOString();
  if (manifest.status !== "recording") {
    updateRunStatus(validated, "recording", { started: startedAt }, getStore());
  }

  const logger = createRunLogger(path.join(validated, "run.log"), false);
  try {
    active = await startCaptureIntoSegment(config, validated, manifest.run_id, manifest.title, startedAt, logger);
  } catch (err) {
    // Roll back status so the user can retry.
    updateRunStatus(validated, "draft", undefined, getStore());
    throw err;
  }
  pausedRunFolder = null;

  appLogger.info("Recording started from draft", {
    runId: manifest.run_id,
    runFolder: validated,
  });

  void openInObsidian(config, path.join(validated, "notes.md"));

  return { run_folder: validated, run_id: manifest.run_id };
}

export async function pauseRecording(): Promise<void> {
  validatePause(currentState());
  const state = active!;
  active = null;

  try {
    await state.session.stop();
  } catch (err) {
    state.logger.warn("Recorder stop threw during pause", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  writeSegmentCaptureMeta(state);
  for (const processId of state.processIds) {
    finishTrackedProcess(processId, { status: "exited" });
  }
  clearActiveRecording();

  updateRunStatus(state.runFolder, "paused", undefined, getStore());
  pausedRunFolder = state.runFolder;

  state.logger.info("Recording paused", { run_folder: state.runFolder });
  appLogger.info("Recording paused", { runFolder: state.runFolder });
}

export async function resumeRecording(): Promise<void> {
  validateResume(currentState());
  const config = loadConfig();
  const validated = resolveRunFolderPath(pausedRunFolder!, config);
  const manifest = loadRunManifest(validated);
  const logger = createRunLogger(path.join(validated, "run.log"), false);

  active = await startCaptureIntoSegment(config, validated, manifest.run_id, manifest.title, manifest.started, logger);
  pausedRunFolder = null;

  appLogger.info("Recording resumed", { runFolder: validated });
}

export async function continueRecording(
  runFolder: string
): Promise<{ run_folder: string; run_id: string }> {
  const config = loadConfig();
  const validated = resolveRunFolderPath(runFolder, config);
  const manifest = loadRunManifest(validated);
  validateContinue(currentState(), manifest.status);

  const logger = createRunLogger(path.join(validated, "run.log"), false);
  active = await startCaptureIntoSegment(config, validated, manifest.run_id, manifest.title, manifest.started, logger);
  pausedRunFolder = null;

  appLogger.info("Recording continued", { runId: manifest.run_id, runFolder: validated });

  return { run_folder: validated, run_id: manifest.run_id };
}

// Imported lazily so the module is usable standalone for tests.
void createRunLogger;
