import path from "node:path";
import {
  FfmpegRecorder,
  loadConfig,
  createRun,
  processRun,
  updateRunStatus,
  saveActiveRecording,
  loadActiveRecording,
  clearActiveRecording,
  openInObsidian,
  createRunLogger,
  type RecordingSession,
  type AppConfig,
  type Logger,
  type PipelineProgressEvent,
} from "@meeting-notes/engine";
import type { RecordingStatus } from "../shared/ipc.js";

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
}

let active: ActiveRecordingState | null = null;

export function isRecording(): boolean {
  return active !== null;
}

export function getActiveState(): ActiveRecordingState | null {
  return active;
}

export async function getStatus(): Promise<RecordingStatus> {
  if (active) {
    return {
      active: true,
      run_id: active.runId,
      title: active.title,
      started_at: active.startedAt,
      run_folder: active.runFolder,
      system_captured: active.systemCaptured,
    };
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

export async function startRecording(title: string): Promise<{ run_folder: string; run_id: string }> {
  if (active) {
    throw new Error("A recording is already in progress. Stop it first.");
  }
  const config = loadConfig();
  const runContext = createRun(config, title, { sourceMode: "both", quiet: true });
  const { folderPath, manifest, logger } = runContext;

  const recorder = new FfmpegRecorder();
  const audioDir = path.join(folderPath, "audio");
  const session = await recorder.start({
    micDevice: config.recording.mic_device,
    systemDevice: config.recording.system_device,
    outputDir: audioDir,
  });

  active = {
    session,
    runFolder: folderPath,
    runId: manifest.run_id,
    title,
    startedAt: manifest.started,
    logger,
    config,
    micPath: session.paths.mic,
    systemPath: session.paths.system,
    systemCaptured: session.systemCaptured,
  };

  // Mirror the CLI's active-recording.json so `meeting-notes stop` can see it.
  saveActiveRecording({
    run_id: manifest.run_id,
    run_folder: folderPath,
    title,
    started_at: manifest.started,
    pids: session.pids,
    mic_path: session.paths.mic,
    system_path: session.paths.system,
    system_captured: session.systemCaptured,
  });

  logger.info("Recording started (via app)", {
    run_id: manifest.run_id,
    mic: session.paths.mic,
    system: session.paths.system ?? "(none)",
  });

  // Try to open notes.md in Obsidian if the integration is on.
  void openInObsidian(config, path.join(folderPath, "notes.md"));

  return { run_folder: folderPath, run_id: manifest.run_id };
}

export interface StopOptions {
  onProgress?: (event: PipelineProgressEvent) => void;
}

export async function stopRecording(
  opts: StopOptions = {}
): Promise<{ run_folder: string } | null> {
  if (!active) {
    // Maybe the CLI has an active recording.
    const cli = loadActiveRecording();
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
      return { run_folder: cli.run_folder };
    }
    return null;
  }

  const state = active;
  active = null;

  try {
    await state.session.stop();
  } catch (err) {
    state.logger.warn("Recorder stop threw", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  clearActiveRecording();

  const audioFiles: { path: string; speaker: "me" | "others" | "unknown" }[] = [];
  if (state.micPath) audioFiles.push({ path: state.micPath, speaker: "me" });
  if (state.systemCaptured && state.systemPath) {
    audioFiles.push({ path: state.systemPath, speaker: "others" });
  }

  if (audioFiles.length === 0) {
    state.logger.error("No audio files captured, marking run as error");
    updateRunStatus(state.runFolder, "error", { ended: new Date().toISOString() });
    return { run_folder: state.runFolder };
  }

  // Kick off processing. We don't await completion here for snappiness —
  // the renderer subscribes to pipeline progress events.
  void (async () => {
    try {
      await processRun({
        config: state.config,
        runFolder: state.runFolder,
        title: state.title,
        date: state.startedAt.split("T")[0],
        audioFiles,
        logger: state.logger,
        onProgress: opts.onProgress,
      });
    } catch (err) {
      state.logger.error("Auto-processing failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();

  return { run_folder: state.runFolder };
}

/** Used during `before-quit` to ensure nothing is left running. */
export async function stopActiveRecording(_reason: string): Promise<void> {
  if (!active) return;
  try {
    await active.session.stop();
  } catch {
    // Best effort.
  }
  clearActiveRecording();
  active = null;
}

// Imported lazily so the module is usable standalone for tests.
void createRunLogger;
