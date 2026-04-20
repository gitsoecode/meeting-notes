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

  return Menu.buildFromTemplate([
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
    { label: "Quit Gistlist", click: () => app.quit() },
  ]);
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
