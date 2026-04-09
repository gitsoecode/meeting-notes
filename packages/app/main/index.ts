import { app, BrowserWindow, globalShortcut, nativeImage } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerIpcHandlers, broadcastRecordingStatus, stopActiveRecording } from "./ipc.js";
import { setupTray } from "./tray.js";
import { ensureOllamaDaemon, stopOllamaDaemon } from "./ollama-daemon.js";
import { loadConfig } from "@meeting-notes/engine";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths: when Vite's dev server env var is set, load from it; otherwise load
// the built index.html. This makes `electron .` work against dist without
// needing a packaged app.
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const IS_DEV = Boolean(DEV_URL);

let mainWindow: BrowserWindow | null = null;

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "Meeting Notes",
    backgroundColor: "#0b0b0e",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.resolve(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (IS_DEV && DEV_URL) {
    void win.loadURL(DEV_URL);
  } else {
    void win.loadFile(path.resolve(__dirname, "../renderer/index.html"));
  }

  win.on("closed", () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  return win;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function ensureMainWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
  return mainWindow;
}

app.whenReady().then(() => {
  if (process.platform === "darwin" && app.dock) {
    const dockIcon = nativeImage.createFromPath(
      path.resolve(__dirname, "../assets/app-icon.png")
    );
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
  }

  mainWindow = createMainWindow();
  registerIpcHandlers();
  setupTray();

  // Kick an initial status broadcast so the renderer can sync.
  broadcastRecordingStatus();

  // If the user has chosen the local LLM provider, bring the Ollama daemon
  // up eagerly so the first reprocess after launch isn't paying the cold-
  // start cost. Cloud-only users skip this entirely. Failure here is
  // non-fatal — the renderer will surface a clear error when it tries to
  // call the LLM.
  try {
    const config = loadConfig();
    if (config.llm_provider === "ollama") {
      void ensureOllamaDaemon().catch(() => {
        // Logged to ~/.meeting-notes/ollama.log; nothing more to do here.
      });
    }
  } catch {
    // No config yet (first run) — wizard will start the daemon at finish.
  }

  // Global shortcut to toggle recording. The default is overridable in
  // Settings, but we start with Cmd+Shift+M.
  const shortcut = "CommandOrControl+Shift+M";
  globalShortcut.register(shortcut, () => {
    const win = ensureMainWindow();
    win.webContents.send("shortcut:toggle-recording");
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    } else {
      ensureMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // On macOS we keep the app alive so the tray icon + global shortcut work.
});

app.on("before-quit", async (event) => {
  event.preventDefault();
  try {
    await stopActiveRecording("app-quit");
  } catch {
    // Best effort.
  }
  try {
    await stopOllamaDaemon();
  } catch {
    // Best effort.
  }
  globalShortcut.unregisterAll();
  app.exit(0);
});
