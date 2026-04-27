import { app, BrowserWindow, globalShortcut, nativeImage, shell } from "electron";
// Must be called before app.whenReady() to have any chance of taking effect.
// In dev this cosmetically renames the app (menu bar, dock tooltip) but TCC
// still identifies the bundle as "Electron" because we're running the stock
// Electron.app from node_modules. In a packaged build the bundle itself is
// named "Gistlist" so TCC agrees.
app.setName("Gistlist");
augmentPathForPackagedDarwin();
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAppLogger, setAppLoggerListener, unloadOllamaModels } from "@gistlist/engine";
import {
  registerIpcHandlers,
  broadcastAppAction,
  broadcastRecordingStatus,
  stopActiveRecording,
} from "./ipc.js";
import { setupTray } from "./tray.js";
import { ensureOllamaDaemon, stopOllamaDaemon, getOllamaState } from "./ollama-daemon.js";
import {
  DEFAULT_CONFIG,
  DEFAULT_EMBEDDING_MODEL,
  listOllamaModels,
  loadConfig,
  pullOllamaModel,
  type AppConfig,
} from "@gistlist/engine";
import { setToggleRecordingHandler, syncToggleRecordingShortcut } from "./shortcuts.js";
import { resolveBin } from "./bundled.js";
import { setFfmpegPath } from "@gistlist/engine";
import { startAudioRetentionTimer } from "./audio-retention.js";
import { getStatus as getRecordingStatus } from "./recording.js";
import { getCachedAudioDevices } from "./device-cache.js";
import { getDb, closeDb } from "./db/connection.js";
import { isEmptyDatabase } from "./db/migrate.js";
import { seedDbFromFilesystem } from "./db/seed.js";
import { registerWindowContextMenu } from "./context-menu.js";
import { handleStructuredAppLog } from "./activity-monitor.js";
import { registerGistlistProtocol } from "./deep-link.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Pull the meeting-index embedding model (`nomic-embed-text`) if it isn't
 * already installed. Best-effort: silent on failure, non-blocking. The
 * index is consumed by the MCP server, which degrades to FTS-only when
 * embeddings are unavailable — so this is a quality-of-life improvement
 * rather than a correctness requirement.
 */
async function ensureMeetingIndexEmbeddingModel(config: AppConfig): Promise<void> {
  try {
    const installed = await listOllamaModels(config.ollama.base_url);
    const have = installed.some(
      (m) => m.name === DEFAULT_EMBEDDING_MODEL || m.name.startsWith(`${DEFAULT_EMBEDDING_MODEL}:`)
    );
    if (have) return;
    appLoggerRef?.info("Pulling meeting-index embedding model in background", {
      detail: DEFAULT_EMBEDDING_MODEL,
    });
    await pullOllamaModel(DEFAULT_EMBEDDING_MODEL, {
      baseUrl: config.ollama.base_url,
    });
    appLoggerRef?.info("Meeting-index embedding model pulled", {
      detail: DEFAULT_EMBEDDING_MODEL,
    });
  } catch (err) {
    appLoggerRef?.warn(
      "ensureMeetingIndexEmbeddingModel failed; meeting-index search will run FTS-only until resolved",
      { detail: err instanceof Error ? err.message : String(err) },
    );
  }
}

let appLoggerRef: ReturnType<typeof createAppLogger> | null = null;

/**
 * Packaged macOS apps launched from Finder/Dock/DMG inherit a minimal PATH
 * (typically `/usr/bin:/bin:/usr/sbin:/sbin`) — Homebrew's `/opt/homebrew/bin`
 * (Apple Silicon) and `/usr/local/bin` (Intel), and MacPorts' `/opt/local/bin`,
 * are absent. Without this, `whichCmd("ffmpeg")` reports "not found" for users
 * who installed via brew, even though the binary is right there. Dev builds
 * launched via `npm run dev` inherit the shell PATH so don't see this.
 *
 * Prepend the well-known Homebrew/MacPorts prefixes so any later PATH lookup
 * (and any subprocess we spawn) can find user-installed tools.
 */
function augmentPathForPackagedDarwin(): void {
  if (process.platform !== "darwin") return;
  if (!app.isPackaged) return;
  const extras = ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"];
  const current = (process.env.PATH ?? "").split(":").filter(Boolean);
  const merged = [...extras.filter((p) => !current.includes(p)), ...current];
  process.env.PATH = merged.join(":");
}

// Paths: when Vite's dev server env var is set, load from it; otherwise load
// the built index.html. This makes `electron .` work against dist without
// needing a packaged app.
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const IS_DEV = Boolean(DEV_URL);
const APP_ICON_PATH = path.resolve(__dirname, "../assets/app-icon.png");

// Register `gistlist://` as a URL scheme so citations from Claude Desktop
// (and any other markdown renderer) can deep-link into specific meetings.
// setAsDefaultProtocolClient + open-url handler must be wired before
// whenReady() so a cold launch via deep link doesn't drop the URL.
registerGistlistProtocol();

let mainWindow: BrowserWindow | null = null;
const appLogger = createAppLogger(false);
appLoggerRef = appLogger;

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
    title: "Gistlist",
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

  // Route any `target="_blank"` (or window.open) navigations to https/http
  // URLs out to the user's default browser, and deny the in-app new
  // window. Keeps Settings doc/legal links from popping up a chromeless
  // Electron window. Anything else is denied for safety.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

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

  // Resolve ffmpeg via our resolver (app-installed → bundled → PATH) and
  // tell the engine the absolute path. Without this the engine spawns the
  // bare `ffmpeg` command, which can fail in packaged GUI apps that miss
  // a Homebrew prefix on PATH even though the binary exists at a known
  // location like ~/Library/Application Support/Gistlist/bin/ffmpeg.
  try {
    const ffmpegBin = await resolveBin("ffmpeg");
    if (ffmpegBin) setFfmpegPath(ffmpegBin.path);
  } catch {
    // Non-fatal: engine falls back to bare "ffmpeg" via PATH.
  }

  registerIpcHandlers();
  appLogger.info("App ready");

  // Initialize SQLite database. The seed is idempotent (INSERT OR IGNORE),
  // so we run it unconditionally on every startup. This turns the
  // filesystem into the source of truth and auto-heals the DB whenever
  // any run folder exists on disk but is missing from SQLite — e.g., after
  // a draft insert transaction rolled back, the user copied in runs from
  // another machine, or a cloud-sync race briefly hid a folder.
  try {
    const db = getDb();
    const config = loadConfig();
    const { resolveRunsPath } = await import("@gistlist/engine");
    const result = seedDbFromFilesystem(db, resolveRunsPath(config));
    if (result.imported > 0) {
      appLogger.info("Database healed from filesystem", {
        detail: `imported ${result.imported} run(s) (${result.skipped} already present, ${result.errors.length} errors)`,
      });
    }
  } catch (err) {
    // Non-fatal — the app works without existing data on first run.
    appLogger.warn("Database init skipped", {
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // Start periodic audio retention cleanup (runs once now, then every 6 hours).
  const stopRetentionTimer = startAudioRetentionTimer();
  app.once("before-quit", () => stopRetentionTimer());

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
        // Logged to ~/.gistlist/ollama.log; nothing more to do here.
      });
    }
    // Ensure the meeting-index embedding model is present. Small (~274MB);
    // pulled silently in the background so semantic search via MCP works
    // without any setup steps from the user.
    void ensureMeetingIndexEmbeddingModel(config).catch(() => {
      // Logged below; non-fatal.
    });
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

  // electron-updater. No-op when UPDATER_ENABLED is false at build
  // time (placeholder publish.repo). When enabled, kicks an initial
  // check after 3s and then every 4h. Recording-guarded — see
  // main/updater.ts for the deferral logic.
  const { bootUpdater } = await import("./updater.js");
  bootUpdater(mainWindow ?? undefined);
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
    const ollamaState = getOllamaState();
    if (ollamaState) {
      await unloadOllamaModels(ollamaState.baseUrl);
    }
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
  try {
    const { shutdownUpdater } = await import("./updater.js");
    shutdownUpdater();
  } catch {
    // Best effort.
  }
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
