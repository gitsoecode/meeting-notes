import { Tray, Menu, nativeImage, app } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureMainWindow } from "./index.js";
import { isRecording } from "./recording.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let tray: Tray | null = null;

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
        const win = ensureMainWindow();
        win.webContents.send("tray:toggle-recording");
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
  // Minimal template icon — 16x16 transparent PNG. In production, swap for
  // an actual design-team-provided tray icon.
  const icon = nativeImage.createFromPath(
    path.resolve(__dirname, "../assets/tray-idle.png")
  );
  // Fall back to an empty image if the asset isn't present yet.
  const image = icon.isEmpty() ? nativeImage.createEmpty() : icon;
  tray = new Tray(image);
  tray.setToolTip("Meeting Notes");
  tray.setContextMenu(buildMenu());
}

export function refreshTray(): void {
  if (!tray) return;
  tray.setContextMenu(buildMenu());
  tray.setToolTip(isRecording() ? "Meeting Notes — Recording" : "Meeting Notes");
}
