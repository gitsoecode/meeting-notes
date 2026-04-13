/**
 * Pure state-machine validation for recording lifecycle transitions.
 *
 * These functions take the current module state as arguments so they can be
 * tested without mocking ffmpeg, the database, or the filesystem.
 */

export interface RecordingModuleState {
  /** An ffmpeg capture session is currently running. */
  hasActiveSession: boolean;
  /** A run is paused (no active capture, but the user intends to resume). */
  hasPausedRun: boolean;
}

// ---- Guards ----

export function validateStartRecording(state: RecordingModuleState): void {
  if (state.hasActiveSession) {
    throw new Error("A recording is already in progress. Stop it first.");
  }
  if (state.hasPausedRun) {
    throw new Error("A recording is paused. Resume or end it first.");
  }
}

export function validateStartForDraft(
  state: RecordingModuleState,
  manifestStatus: string
): void {
  if (state.hasActiveSession) {
    throw new Error("A recording is already in progress. Stop it first.");
  }
  // Allow "recording" as a recovery case: the status was left as "recording"
  // from a prior failed start but there is no active session.
  if (manifestStatus !== "draft" && manifestStatus !== "recording") {
    throw new Error(
      `Cannot start recording: run status is "${manifestStatus}", expected "draft".`
    );
  }
}

export function validatePause(state: RecordingModuleState): void {
  if (!state.hasActiveSession) {
    throw new Error("No active recording to pause.");
  }
}

export function validateResume(state: RecordingModuleState): void {
  if (state.hasActiveSession) {
    throw new Error("A recording is already active.");
  }
  if (!state.hasPausedRun) {
    throw new Error("No paused recording to resume.");
  }
}

export function validateContinue(
  state: RecordingModuleState,
  manifestStatus: string
): void {
  if (state.hasActiveSession) {
    throw new Error("A recording is already in progress. Stop it first.");
  }
  if (manifestStatus !== "complete" && manifestStatus !== "paused") {
    throw new Error(`Cannot continue: run status is "${manifestStatus}".`);
  }
}

// ---- Stop target resolution ----

export type StopTarget = "active" | "paused" | "cli" | null;

/**
 * Determine what `stopRecording` should act on given the current state.
 * Returns null when there is nothing to stop.
 */
export function resolveStopTarget(
  state: RecordingModuleState,
  hasCliRecording: boolean
): StopTarget {
  if (state.hasActiveSession) return "active";
  if (state.hasPausedRun) return "paused";
  if (hasCliRecording) return "cli";
  return null;
}
