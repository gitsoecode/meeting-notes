import { Tray, Menu, nativeImage, app } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureMainWindow } from "./index.js";
import { broadcastAppAction } from "./ipc.js";
import { getStatus as getRecordingStatus, isRecording } from "./recording.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let tray: Tray | null = null;
let idleIcon: Electron.NativeImage | null = null;
let recordingIcon: Electron.NativeImage | null = null;

async function dispatchTrayAction(): Promise<void> {
  const status = await getRecordingStatus();
  ensureMainWindow();
  broadcastAppAction({
    type: status.active ? "toggle-recording" : "open-new-meeting",
    source: "tray",
  });
}

function buildMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: isRecording() ? "● Recording…" : "Meeting Notes",
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Open Meeting Notes",
      click: () => {
        ensureMainWindow();
      },
    },
    {
      label: isRecording() ? "Stop Recording" : "Start Recording",
      click: () => {
        void dispatchTrayAction();
      },
    },
    { type: "separator" },
    {
      label: "Quit Meeting Notes",
      click: () => {
        app.quit();
      },
    },
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
  idleIcon.setTemplateImage(true);
  recordingIcon.setTemplateImage(true);
  if (idleIcon.isEmpty()) {
    throw new Error(
      "tray-idleTemplate.png missing from dist/assets — run `npm run build:assets`"
    );
  }
  tray = new Tray(idleIcon);
  tray.setToolTip("Meeting Notes");
  tray.setContextMenu(buildMenu());
}

export function refreshTray(): void {
  if (!tray) return;
  tray.setContextMenu(buildMenu());
  tray.setToolTip(isRecording() ? "Meeting Notes — Recording" : "Meeting Notes");
  if (idleIcon && recordingIcon) {
    tray.setImage(isRecording() ? recordingIcon : idleIcon);
  }
}
