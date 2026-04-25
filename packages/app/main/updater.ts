/**
 * electron-updater wrapper with two behaviors gated by build flags.
 *
 * Build-time gating (NOT runtime env): the generated build-flags.ts
 * (written by scripts/write-build-flags.mjs from package.json's
 * `build.publish.repo`) decides whether `UPDATER_ENABLED` is true
 * for this build. The shipped app reads the constant directly — no
 * `process.env` checks at runtime. This prevents preload/renderer
 * skew (the renderer just calls `updater.getStatus()` and gets
 * `{ enabled: false }` back from inert handlers when disabled).
 *
 * When enabled:
 *   - autoDownload: false. We never grab bytes without consent.
 *   - autoInstallOnAppQuit: false. Downloaded artifacts sit until
 *     the user explicitly clicks Install — covers the "downloaded
 *     but quit before installing" recovery case for free.
 *   - Periodic check every 4h, with an initial check 3s after launch.
 *   - Recording guard: download AND install both deferred while
 *     recording is active. No OS Notifications during recording —
 *     in-app banner only. Re-fires once recording stops.
 *
 * When disabled: this module never imports electron-updater, never
 * registers timers, and the IPC handlers all return inert
 * `{ enabled: false }` shapes.
 *
 * Dev simulator (updater-dev.ts) lets us exercise the UI without
 * a real GitHub release. It fires synthetic events through the same
 * `updater:status` channel the production updater uses.
 */
import fs from "node:fs";
import path from "node:path";
import type { BrowserWindow } from "electron";
import { broadcastToAll } from "./events.js";
import { isRecording } from "./recording.js";
import { userDataDir } from "./paths.js";
import { UPDATER_ENABLED, PUBLISH_REPO } from "./build-flags.js";

// ---- Types & constants -----------------------------------------------------

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
  /** Bytes downloaded so far (kind === "downloading"). */
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
  /** Auto-check periodically + 3s after launch. Default true. */
  autoCheck: boolean;
  /** Show in-app banner when an update is available. Default true. */
  notifyBanner: boolean;
}

const DEFAULT_PREFS: UpdaterPreferences = {
  autoCheck: true,
  notifyBanner: true,
};

const PREFS_FILE_NAME = "updater-prefs.json";
const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4h
const INITIAL_CHECK_DELAY_MS = 3_000;

// ---- Module-level state ----------------------------------------------------

let currentStatus: UpdaterStatus = UPDATER_ENABLED
  ? { enabled: true, kind: "idle" }
  : { enabled: false, kind: "disabled-at-build" };
let recheckTimer: NodeJS.Timeout | null = null;
let initialCheckTimer: NodeJS.Timeout | null = null;
let pendingDownloadAfterRecording = false;
let pendingInstallAfterRecording = false;

// electron-updater is loaded lazily — we only `await import` it when
// UPDATER_ENABLED is true. That keeps the disabled-build code path
// from depending on it at all.
type AutoUpdaterShape = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  setFeedURL: (opts: unknown) => void;
  checkForUpdates: () => Promise<unknown>;
  downloadUpdate: () => Promise<unknown>;
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
};
let autoUpdater: AutoUpdaterShape | null = null;

// ---- Preferences (persisted) -----------------------------------------------

function prefsPath(): string {
  return path.join(userDataDir(), PREFS_FILE_NAME);
}

export function loadPrefs(): UpdaterPreferences {
  try {
    const raw = fs.readFileSync(prefsPath(), "utf-8");
    const parsed = JSON.parse(raw);
    return {
      autoCheck:
        typeof parsed.autoCheck === "boolean"
          ? parsed.autoCheck
          : DEFAULT_PREFS.autoCheck,
      notifyBanner:
        typeof parsed.notifyBanner === "boolean"
          ? parsed.notifyBanner
          : DEFAULT_PREFS.notifyBanner,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: UpdaterPreferences): void {
  fs.mkdirSync(userDataDir(), { recursive: true });
  fs.writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2), "utf-8");
}

// ---- Status broadcasting ---------------------------------------------------

function setStatus(next: UpdaterStatus): void {
  currentStatus = next;
  broadcastToAll("updater:status", next);
}

export function getStatus(): UpdaterStatus {
  return currentStatus;
}

// ---- Production wiring (only entered when UPDATER_ENABLED) -----------------

async function ensureAutoUpdater(): Promise<AutoUpdaterShape> {
  if (autoUpdater) return autoUpdater;
  // Dynamic import keeps the disabled build path from loading the dep.
  const mod = await import("electron-updater");
  const au = (mod as { autoUpdater: AutoUpdaterShape }).autoUpdater;
  au.autoDownload = false;
  au.autoInstallOnAppQuit = false;

  // Wire status events. We translate electron-updater's verbose event
  // surface into our compact UpdaterStatus shape so the renderer has
  // exactly one channel to subscribe to.
  au.on("checking-for-update", () => {
    setStatus({
      ...currentStatus,
      kind: "checking",
      lastChecked: new Date().toISOString(),
    });
  });
  au.on("update-available", (info: unknown) => {
    const i = info as { version?: string; releaseNotesUrl?: string };
    setStatus({
      enabled: true,
      kind: "available",
      version: i.version,
      releaseNotesUrl: i.releaseNotesUrl,
    });
  });
  au.on("update-not-available", () => {
    setStatus({ enabled: true, kind: "no-update" });
  });
  au.on("download-progress", (progress: unknown) => {
    const p = progress as {
      bytesPerSecond?: number;
      transferred?: number;
      total?: number;
    };
    setStatus({
      ...currentStatus,
      kind: "downloading",
      bytesPerSecond: p.bytesPerSecond,
      bytesDone: p.transferred,
      bytesTotal: p.total,
    });
  });
  au.on("update-downloaded", (info: unknown) => {
    const i = info as { version?: string };
    setStatus({
      enabled: true,
      kind: "downloaded",
      version: i.version,
    });
  });
  au.on("error", (err: unknown) => {
    const e = err as Error;
    setStatus({
      enabled: true,
      kind: "error",
      error: e.message,
    });
  });

  autoUpdater = au;
  return au;
}

// ---- Public IPC entry points (always present, behavior gated) --------------

/** Manually invoke a check. Returns the new status. */
export async function checkForUpdates(): Promise<UpdaterStatus> {
  if (!UPDATER_ENABLED) return getStatus();
  try {
    const au = await ensureAutoUpdater();
    await au.checkForUpdates();
  } catch (err) {
    setStatus({
      enabled: true,
      kind: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return getStatus();
}

/** Begin downloading the announced update. Recording-guarded. */
export async function startDownload(): Promise<UpdaterStatus> {
  if (!UPDATER_ENABLED) return getStatus();
  if (isRecording()) {
    pendingDownloadAfterRecording = true;
    setStatus({ ...currentStatus, kind: "deferred-recording" });
    return getStatus();
  }
  try {
    const au = await ensureAutoUpdater();
    await au.downloadUpdate();
  } catch (err) {
    setStatus({
      enabled: true,
      kind: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return getStatus();
}

/** Quit and install the downloaded update. Recording-guarded. */
export async function installAndRestart(): Promise<UpdaterStatus> {
  if (!UPDATER_ENABLED) return getStatus();
  if (isRecording()) {
    pendingInstallAfterRecording = true;
    setStatus({ ...currentStatus, kind: "deferred-recording" });
    return getStatus();
  }
  try {
    const au = await ensureAutoUpdater();
    au.quitAndInstall(false, true);
  } catch (err) {
    setStatus({
      enabled: true,
      kind: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return getStatus();
}

// ---- Recording-stop hook ---------------------------------------------------

/**
 * Called by the recording-state module when active recording transitions
 * to stopped. If we deferred a download or install while recording,
 * fire it now.
 */
export function onRecordingStopped(): void {
  if (!UPDATER_ENABLED) return;
  if (pendingInstallAfterRecording) {
    pendingInstallAfterRecording = false;
    void installAndRestart();
    return;
  }
  if (pendingDownloadAfterRecording) {
    pendingDownloadAfterRecording = false;
    void startDownload();
  }
}

// ---- Lifecycle -------------------------------------------------------------

let booted = false;

/** Boot the updater. Safe to call multiple times. No-op when disabled. */
export function bootUpdater(_mainWindow?: BrowserWindow): void {
  if (booted) return;
  booted = true;

  if (!UPDATER_ENABLED) {
    // Disabled-at-build — broadcast the inert status so the renderer
    // knows to hide the UI surface entirely on first read.
    setStatus({ enabled: false, kind: "disabled-at-build" });
    return;
  }

  // Initial broadcast so the renderer sees enabled=true on startup.
  setStatus({ enabled: true, kind: "idle" });

  const prefs = loadPrefs();
  if (!prefs.autoCheck) return;

  initialCheckTimer = setTimeout(() => {
    void checkForUpdates();
  }, INITIAL_CHECK_DELAY_MS);

  recheckTimer = setInterval(() => {
    void checkForUpdates();
  }, RECHECK_INTERVAL_MS);
}

/** Shut down timers cleanly on app quit. */
export function shutdownUpdater(): void {
  if (initialCheckTimer) {
    clearTimeout(initialCheckTimer);
    initialCheckTimer = null;
  }
  if (recheckTimer) {
    clearInterval(recheckTimer);
    recheckTimer = null;
  }
}

/** Test-only: manually publish a status (used by the dev simulator). */
export function __dev_setStatus(next: UpdaterStatus): void {
  setStatus(next);
}

// Re-export the build-time flag so callers (renderer, IPC) can short-
// circuit without re-importing build-flags directly.
export const updaterEnabled = UPDATER_ENABLED;
export const publishRepo = PUBLISH_REPO;
