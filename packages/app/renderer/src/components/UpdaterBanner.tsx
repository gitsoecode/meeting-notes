import { useEffect, useState } from "react";
import { api } from "../ipc-client";
import type {
  UpdaterStatus,
  UpdaterPreferences,
} from "../../../shared/ipc";
import { Button } from "./ui/button";

/**
 * Top-of-app banner that surfaces actionable updater states to the
 * user without requiring them to open Settings.
 *
 * Renders nothing when:
 *   - The updater is build-disabled (UPDATER_ENABLED=false → status.enabled=false).
 *   - The user has turned off banner notifications in Settings.
 *   - The status doesn't warrant a banner (idle / no-update / checking / error).
 *   - The user dismissed this exact version (per-version dismissal so a
 *     later version still shows the banner).
 *
 * The banner is intentionally small — about 60 lines of TSX — so it
 * doesn't compete with the meeting view for attention.
 */
export function UpdaterBanner() {
  const [status, setStatus] = useState<UpdaterStatus | null>(null);
  const [prefs, setPrefs] = useState<UpdaterPreferences | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(
    null
  );

  useEffect(() => {
    api.updater.getStatus().then(setStatus).catch(() => {});
    api.updater.getPrefs().then(setPrefs).catch(() => {});
    // Re-fetch prefs on every status update too. Settings calls
    // setPrefs and the main side broadcasts updaterStatus afterward
    // (the prod updater also re-emits status when prefs change). This
    // is the cheapest way to keep the banner's prefs copy in sync
    // without lifting state into a global store.
    const unsub = api.on.updaterStatus((s) => {
      setStatus(s);
      api.updater.getPrefs().then(setPrefs).catch(() => {});
    });
    return () => {
      unsub();
    };
  }, []);

  // Build-disabled: no updater UI surface at all.
  if (!status?.enabled) return null;
  // User opted out of banner notifications.
  if (prefs && !prefs.notifyBanner) return null;
  // Per-version dismissal: same version → stay hidden until a different
  // version is announced.
  if (status.version && status.version === dismissedVersion) return null;

  // Only these kinds warrant pushing a banner at the user. Idle /
  // checking / no-update / error all live in Settings only.
  const showsBanner =
    status.kind === "available" ||
    status.kind === "downloading" ||
    status.kind === "downloaded" ||
    status.kind === "deferred-recording";
  if (!showsBanner) return null;

  const message =
    status.kind === "available"
      ? `Update ${status.version ?? "available"} is ready to download.`
      : status.kind === "downloading"
        ? `Downloading update${
            status.bytesTotal && status.bytesDone !== undefined
              ? ` — ${Math.round((status.bytesDone / status.bytesTotal) * 100)}%`
              : "…"
          }`
        : status.kind === "downloaded"
          ? `Update ${status.version ?? ""} is ready to install.`
          : "Update deferred — we'll resume after this recording finishes.";

  const onDownload = () => void api.updater.download();
  const onInstall = () => void api.updater.install();
  const onDismiss = () => {
    if (status.version) setDismissedVersion(status.version);
    else setDismissedVersion("__dismissed-no-version__");
  };

  return (
    <div
      data-testid="updater-banner"
      className="border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-2 text-sm flex items-center gap-3"
    >
      <span className="text-[var(--text-primary)] flex-1">{message}</span>
      {status.kind === "available" && (
        <Button size="sm" onClick={onDownload} data-testid="updater-banner-download">
          Download
        </Button>
      )}
      {status.kind === "downloaded" && (
        <Button size="sm" onClick={onInstall} data-testid="updater-banner-install">
          Install &amp; Restart
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={onDismiss}
        data-testid="updater-banner-dismiss"
      >
        Dismiss
      </Button>
    </div>
  );
}
