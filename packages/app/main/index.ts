import { app, BrowserWindow, globalShortcut, nativeImage } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAppLogger, setAppLoggerListener } from "@meeting-notes/engine";
import {
  registerIpcHandlers,
  broadcastAppAction,
  broadcastRecordingStatus,
  stopActiveRecording,
} from "./ipc.js";
import { setupTray } from "./tray.js";
import { ensureOllamaDaemon, stopOllamaDaemon } from "./ollama-daemon.js";
import { DEFAULT_CONFIG, loadConfig } from "@meeting-notes/engine";
import { setToggleRecordingHandler, syncToggleRecordingShortcut } from "./shortcuts.js";
import { getStatus as getRecordingStatus } from "./recording.js";
import { getCachedAudioDevices } from "./device-cache.js";
import { getDb, closeDb } from "./db/connection.js";
import { isEmptyDatabase } from "./db/migrate.js";
import { seedDbFromFilesystem } from "./db/seed.js";
import { registerWindowContextMenu } from "./context-menu.js";
import { handleStructuredAppLog } from "./activity-monitor.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths: when Vite's dev server env var is set, load from it; otherwise load
// the built index.html. This makes `electron .` work against dist without
// needing a packaged app.
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const IS_DEV = Boolean(DEV_URL);
const APP_ICON_PATH = path.resolve(__dirname, "../assets/app-icon.png");

let mainWindow: BrowserWindow | null = null;
const appLogger = createAppLogger(false);

setAppLoggerListener(handleStructuredAppLog);

function loadAppIcon(): Electron.NativeImage | undefined {
  const icon = nativeImage.createFromPath(APP_ICON_PATH);
  return icon.isEmpty() ? undefined : icon;
}

function createMainWindow(): BrowserWindow {
  appLogger.info("Creating main window");
  const icon = loadAppIcon();
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 820,
    minHeight: 620,
    title: "Meeting Notes",
    show: false,
    backgroundColor: "#f6f7f2",
    titleBarStyle: "hiddenInset",
    icon,
    webPreferences: {
      preload: path.resolve(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  registerWindowContextMenu(win);

  if (IS_DEV && DEV_URL) {
    void win.loadURL(DEV_URL);
  } else {
    void win.loadFile(path.resolve(__dirname, "../renderer/index.html"));
  }

  win.once("ready-to-show", () => {
    appLogger.info("Main window ready to show");
    win.show();
  });

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

async function dispatchWindowAction(source: "shortcut" | "tray"): Promise<void> {
  const status = await getRecordingStatus();
  const win = ensureMainWindow();
  broadcastAppAction({
    type: status.active ? "toggle-recording" : "open-new-meeting",
    source,
  });
  win.focus();
}

app.whenReady().then(async () => {
  const dockIcon = loadAppIcon();
  if (process.platform === "darwin" && app.dock && dockIcon) {
    app.dock.setIcon(dockIcon);
  }

  registerIpcHandlers();
  appLogger.info("App ready");

  // Initialize SQLite database — seed from filesystem on first run.
  try {
    const db = getDb();
    if (isEmptyDatabase(db)) {
      const config = loadConfig();
      const { resolveRunsPath } = await import("@meeting-notes/engine");
      seedDbFromFilesystem(db, resolveRunsPath(config));
    }
  } catch (err) {
    // Non-fatal — the app works without existing data on first run.
    appLogger.warn("Database init skipped", {
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  mainWindow = createMainWindow();
  setupTray();

  // Kick an initial status broadcast so the renderer can sync.
  broadcastRecordingStatus();

  // Warm the audio device cache so the first recording start doesn't pay
  // the ffmpeg device-enumeration cost (~200-400ms).
  void getCachedAudioDevices().catch(() => {});

  setToggleRecordingHandler(() => {
    void dispatchWindowAction("shortcut");
  });

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

  const shortcut =
    safeLoadShortcut() ?? DEFAULT_CONFIG.shortcuts.toggle_recording;
  const shortcutResult = syncToggleRecordingShortcut(shortcut);
  if (!shortcutResult.ok) {
    appLogger.warn("Failed to register global shortcut", { detail: shortcut });
    console.warn(`Failed to register global shortcut: ${shortcut}`);
  }

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
  appLogger.info("App quit requested");
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
  closeDb();
  globalShortcut.unregisterAll();
  appLogger.info("App quit complete");
  app.exit(0);
});

function safeLoadShortcut(): string | null {
  try {
    return loadConfig().shortcuts.toggle_recording;
  } catch {
    return null;
  }
}
