import { Tray, Menu, nativeImage, app } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureMainWindow } from "./index.js";
import { broadcastAppAction } from "./ipc.js";
import { getStatus as getRecordingStatus, isRecording, isPaused } from "./recording.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let tray: Tray | null = null;
let idleIcon: Electron.NativeImage | null = null;
let recordingIcon: Electron.NativeImage | null = null;
let pausedIcon: Electron.NativeImage | null = null;

async function dispatchTrayAction(): Promise<void> {
  const status = await getRecordingStatus();
  ensureMainWindow();
  broadcastAppAction({
    type: status.active ? "toggle-recording" : "open-new-meeting",
    source: "tray",
  });
}

function buildMenu(): Menu {
  const recording = isRecording();
  const paused = isPaused();

  if (recording) {
    return Menu.buildFromTemplate([
      { label: "● Recording…", enabled: false },
      { type: "separator" },
      {
        label: "Pause Recording",
        click: () => {
          ensureMainWindow();
          broadcastAppAction({ type: "toggle-recording", source: "tray" });
        },
      },
      {
        label: "End Meeting",
        click: () => {
          void dispatchTrayAction();
        },
      },
      { type: "separator" },
      { label: "Open Gistlist", click: () => ensureMainWindow() },
      { type: "separator" },
      { label: "Quit Gistlist", click: () => app.quit() },
    ]);
  }

  if (paused) {
    return Menu.buildFromTemplate([
      { label: "⏸ Paused", enabled: false },
      { type: "separator" },
      {
        label: "Resume Recording",
        click: () => {
          ensureMainWindow();
          broadcastAppAction({ type: "toggle-recording", source: "tray" });
        },
      },
      {
        label: "End Meeting",
        click: () => {
          void dispatchTrayAction();
        },
      },
      { type: "separator" },
      { label: "Open Gistlist", click: () => ensureMainWindow() },
      { type: "separator" },
      { label: "Quit Gistlist", click: () => app.quit() },
    ]);
  }

  // Conditional menu items — only render entries the user can act on.
  // "Check for Updates" appears only when the updater is enabled at
  // build time; otherwise the entry would be a no-op and users would
  // (correctly) wonder what it does.
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: "Gistlist", enabled: false },
    { type: "separator" },
    { label: "Open Gistlist", click: () => ensureMainWindow() },
    {
      label: "Quick Record",
      click: () => {
        void dispatchTrayAction();
      },
    },
    { type: "separator" },
    {
      label: "Send Feedback…",
      click: () => {
        void import("./feedback.js")
          .then((m) => m.openFeedbackMail())
          .catch(() => {});
      },
    },
  ];

  // Lazy-import to avoid pulling updater code into the tray module's
  // synchronous load path. We only check the build flag here.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { updaterEnabled } = require("./updater.js");
    if (updaterEnabled) {
      items.push({
        label: "Check for Updates…",
        click: () => {
          void import("./updater.js").then((m) => m.checkForUpdates());
        },
      });
    }
  } catch {
    // build-flags / updater not available yet (very-early-launch race) —
    // skip silently. The Settings page exposes the same control.
  }

  items.push({ type: "separator" });
  items.push({ label: "Quit Gistlist", click: () => app.quit() });

  return Menu.buildFromTemplate(items);
}

export function setupTray(): void {
  if (tray) return;
  idleIcon = nativeImage.createFromPath(
    path.resolve(__dirname, "../assets/tray-idleTemplate.png")
  );
  recordingIcon = nativeImage.createFromPath(
    path.resolve(__dirname, "../assets/tray-recordingTemplate.png")
  );
  // Paused icon falls back to idle if the asset doesn't exist yet
  const pausedPath = path.resolve(__dirname, "../assets/tray-pausedTemplate.png");
  pausedIcon = nativeImage.createFromPath(pausedPath);
  if (pausedIcon.isEmpty()) pausedIcon = null;

  idleIcon.setTemplateImage(true);
  recordingIcon.setTemplateImage(true);
  pausedIcon?.setTemplateImage(true);

  if (idleIcon.isEmpty()) {
    throw new Error(
      "tray-idleTemplate.png missing from dist/assets — run `npm run build:assets`"
    );
  }
  tray = new Tray(idleIcon);
  tray.setToolTip("Gistlist");
  tray.setContextMenu(buildMenu());
}

export function refreshTray(): void {
  if (!tray) return;
  tray.setContextMenu(buildMenu());

  const recording = isRecording();
  const paused = isPaused();

  tray.setToolTip(
    recording
      ? "Gistlist — Recording"
      : paused
        ? "Gistlist — Paused"
        : "Gistlist"
  );

  if (idleIcon && recordingIcon) {
    if (recording) {
      tray.setImage(recordingIcon);
    } else if (paused && pausedIcon) {
      tray.setImage(pausedIcon);
    } else {
      tray.setImage(idleIcon);
    }
  }
}
