/**
 * Dev-only simulator for the updater UI. Lets us exercise the
 * Check-for-Updates / Download / Install flow against synthetic
 * events without needing a real GitHub release.
 *
 * Not registered when `app.isPackaged` is true. The shipped app
 * never imports this — the IPC handlers in main/ipc.ts skip
 * registration in production.
 *
 * It does NOT simulate `quitAndInstall`. The fake "Install" call
 * returns `{ ok: false, status: "simulated-install-blocked" }` so
 * we never accidentally wire fake quit paths into tests.
 */
import { __dev_setStatus, type UpdaterStatus } from "./updater.js";

const DEFAULT_FAKE_VERSION = "0.1.99-simulated";

export interface SimulateUpdateOptions {
  /** Version string the synthetic update advertises. */
  version?: string;
  /** Bytes the simulated download streams through. */
  totalBytes?: number;
  /** ms between progress ticks. */
  tickIntervalMs?: number;
  /** GitHub release notes URL (for banner UX testing). */
  releaseNotesUrl?: string;
}

let activeProgressTimer: NodeJS.Timeout | null = null;

/** Fire `available` then a stream of `downloading` ticks ending in `downloaded`. */
export function simulateAvailableAndDownload(
  opts: SimulateUpdateOptions = {}
): void {
  const version = opts.version ?? DEFAULT_FAKE_VERSION;
  const totalBytes = opts.totalBytes ?? 28 * 1024 * 1024; // ~28MB realistic
  const tickInterval = opts.tickIntervalMs ?? 100;

  __dev_setStatus({
    enabled: true,
    kind: "available",
    version,
    releaseNotesUrl: opts.releaseNotesUrl,
  });

  // Don't auto-download in the simulator — caller calls
  // simulateDownloadStart() to mirror the production "user clicked
  // Download" interaction.
}

/** Begin a fake download — emits `downloading` updates until reaching total. */
export function simulateDownloadStart(opts: SimulateUpdateOptions = {}): void {
  const totalBytes = opts.totalBytes ?? 28 * 1024 * 1024;
  const tickInterval = opts.tickIntervalMs ?? 100;
  const version = opts.version ?? DEFAULT_FAKE_VERSION;

  if (activeProgressTimer) clearInterval(activeProgressTimer);

  let bytesDone = 0;
  const bytesPerTick = Math.max(1, Math.floor(totalBytes / 25));

  activeProgressTimer = setInterval(() => {
    bytesDone = Math.min(totalBytes, bytesDone + bytesPerTick);
    if (bytesDone >= totalBytes) {
      if (activeProgressTimer) {
        clearInterval(activeProgressTimer);
        activeProgressTimer = null;
      }
      __dev_setStatus({
        enabled: true,
        kind: "downloaded",
        version,
        bytesDone: totalBytes,
        bytesTotal: totalBytes,
      });
      return;
    }
    __dev_setStatus({
      enabled: true,
      kind: "downloading",
      version,
      bytesDone,
      bytesTotal: totalBytes,
      bytesPerSecond: bytesPerTick * (1000 / tickInterval),
    });
  }, tickInterval);
}

/**
 * Fake the "Install" click. We deliberately do NOT invoke quitAndInstall
 * because that would actually quit the app — the simulator is for UI
 * testing, not a kill-switch. Returns a sentinel status the spec asserts.
 */
export function simulateInstallAttempt(): {
  ok: false;
  status: "simulated-install-blocked";
} {
  return { ok: false, status: "simulated-install-blocked" };
}

/** Fire an `error` status — for testing the error-banner path. */
export function simulateError(message: string): void {
  __dev_setStatus({
    enabled: true,
    kind: "error",
    error: message,
  });
}

/** Reset the simulator state — useful between specs. */
export function simulateReset(): void {
  if (activeProgressTimer) {
    clearInterval(activeProgressTimer);
    activeProgressTimer = null;
  }
  __dev_setStatus({ enabled: true, kind: "idle" });
}

export type SimulatorAction =
  | "available-and-prompt"
  | "download-start"
  | "install-attempt"
  | "error"
  | "reset";

/** Single entrypoint the IPC layer dispatches into. */
export function dispatchSimulator(
  action: SimulatorAction,
  payload?: { message?: string; version?: string }
): UpdaterStatus | { ok: false; status: "simulated-install-blocked" } {
  switch (action) {
    case "available-and-prompt":
      simulateAvailableAndDownload({ version: payload?.version });
      return {
        enabled: true,
        kind: "available",
        version: payload?.version ?? DEFAULT_FAKE_VERSION,
      };
    case "download-start":
      simulateDownloadStart({ version: payload?.version });
      return {
        enabled: true,
        kind: "downloading",
        version: payload?.version ?? DEFAULT_FAKE_VERSION,
      };
    case "install-attempt":
      return simulateInstallAttempt();
    case "error":
      simulateError(payload?.message ?? "Simulated update error");
      return {
        enabled: true,
        kind: "error",
        error: payload?.message ?? "Simulated update error",
      };
    case "reset":
      simulateReset();
      return { enabled: true, kind: "idle" };
  }
}
