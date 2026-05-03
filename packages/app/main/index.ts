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
  loadConfig,
} from "@gistlist/engine";
import { setToggleRecordingHandler, syncToggleRecordingShortcut } from "./shortcuts.js";
import { resolveBin } from "./bundled.js";
import { resolveAndValidate } from "./installers/validated-resolve.js";
import { resolveAudioTeeBinary } from "./audiotee-binary.js";
import { resolveMicCaptureBinary } from "./mic-capture-binary.js";
import { setFfmpegPath, setFfprobePath, setPythonPath, testAudioCapture } from "@gistlist/engine";
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
// `ensureMeetingIndexEmbeddingModel(config)` used to live here and
// silently pull `nomic-embed-text` into Ollama on app startup whenever
// the model wasn't already installed. v0.1.9 removed it: the user's
// stated rule for v0.1.9 was "explicit click, no surprise installs."
// We removed the silent pull from `Finish setup` (renderer) but the
// startup auto-pull was the same product violation hiding in main —
// the next launch after Finish would pull the 274 MB model regardless
// of whether the user had clicked the explicit "Download embedding
// model" button. The model now installs ONLY through the wizard's
// dedicated row (`installEmbedModel` → `meeting-index:install-embed-
// model` IPC) or, in the future, an equivalent explicit Settings
// affordance. No auto-pull. The MCP server's meeting-index search
// degrades to FTS-only when embeddings are missing — that's a
// quality-of-life cost, not a correctness bug, and the user has
// explicitly chosen the trade-off.

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

/**
 * Hidden packaged smoke entrypoint. Invoked by
 * `packages/app/scripts/smoke-packaged-audio.mjs` to prove the
 * signed/notarized binary actually captures non-silent mic + system
 * audio under macOS hardened runtime + TCC enforcement, not just that
 * static entitlement keys look right. No UI surface — runs the same
 * code path as the recording:test-audio IPC handler, writes a single
 * line of JSON to the path passed via `--smoke-output=<path>` (and
 * stdout for logging), exits.
 *
 * The driver launches us via `open -n -W -a` so LaunchServices
 * establishes the freshly-built bundle as its own responsible TCC
 * session. Without that, macOS attributes TCC checks to whatever
 * spawned the driver (e.g. a terminal, an agent harness), and any
 * grant the user gave Gistlist in System Settings does not apply —
 * the smoke comes back with flat -91 dB silence even on a working
 * build.
 *
 * Self-imposes a 25s hard timeout — `open -W` waits on launchd, not
 * on a child PID, so the driver killing `open` would not stop a
 * stuck app process.
 */
async function runAudioSmoke(): Promise<void> {
  const outputArg = process.argv.find((a) => a.startsWith("--smoke-output="));
  const outputPath = outputArg ? outputArg.slice("--smoke-output=".length) : "";

  function emit(payload: unknown, code: number): void {
    const line = JSON.stringify(payload) + "\n";
    process.stdout.write(line);
    if (outputPath) {
      try {
        fs.writeFileSync(outputPath, line);
      } catch {
        // Driver will surface the missing output file as a failure.
      }
    }
    app.exit(code);
  }

  // Hard-cap the smoke run. testAudioCapture sleeps 6s for capture
  // plus a few seconds of CoreAudio init; 25s is generous headroom.
  const watchdog = setTimeout(() => {
    emit(
      {
        error: "smoke watchdog tripped at 25s — capture likely stuck on TCC",
      },
      3
    );
  }, 25_000);
  watchdog.unref?.();

  try {
    // Same validated-injection rule as app startup — a stale wrong-arch
    // binary would EBADARCH the smoke driver before it could even
    // record. Use `resolveAndValidate` so the smoke driver picks up
    // PATH instead when the app-managed binary is broken.
    const ffmpegRes = await resolveAndValidate("ffmpeg");
    if (ffmpegRes.injectable && ffmpegRes.path) setFfmpegPath(ffmpegRes.path);
    const ffprobeRes = await resolveAndValidate("ffprobe");
    if (ffprobeRes.injectable && ffprobeRes.path) setFfprobePath(ffprobeRes.path);
  } catch {
    // Non-fatal — fall back to PATH; smoke driver will catch silent capture.
  }

  try {
    let micDevice = "";
    let systemDevice = "";
    try {
      const config = loadConfig();
      micDevice = config.recording.mic_device ?? "";
      systemDevice = config.recording.system_device ?? "";
    } catch {
      // Smoke driver points GISTLIST_USER_DATA_DIR at a fresh tempdir,
      // so loadConfig may surface no file — testAudioCapture's
      // pickPhysicalMic fallback handles empty mic_device.
    }
    const report = await testAudioCapture({
      micDevice,
      systemDevice,
      durationMs: 6000,
      audioTeeBinaryPath: resolveAudioTeeBinary(),
      micCaptureBinaryPath: resolveMicCaptureBinary(),
    });
    clearTimeout(watchdog);
    emit(report, 0);
  } catch (err) {
    clearTimeout(watchdog);
    emit(
      {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
      1
    );
  }
}

app.whenReady().then(async () => {
  // Hidden flag: prove the signed binary can actually capture audio
  // under macOS hardened runtime + TCC. Skips all normal startup —
  // no window, no IPC handlers, no Ollama, no DB. See runAudioSmoke
  // and packages/app/scripts/smoke-packaged-audio.mjs.
  //
  // Two-factor gate: --smoke-audio CLI arg AND GISTLIST_ALLOW_SMOKE_AUDIO=1
  // env var. The env var is set by the smoke driver via
  // `open --env GISTLIST_ALLOW_SMOKE_AUDIO=1` and is therefore not present
  // on a normal Dock/Finder launch even if someone discovers the flag.
  // Belt-and-suspenders for a code path that briefly opens the mic and
  // system-audio tap on a production-signed binary.
  if (
    process.argv.includes("--smoke-audio") &&
    process.env.GISTLIST_ALLOW_SMOKE_AUDIO === "1"
  ) {
    await runAudioSmoke();
    return;
  }

  const dockIcon = loadAppIcon();
  if (process.platform === "darwin" && app.dock && dockIcon) {
    app.dock.setIcon(dockIcon);
  }

  // Resolve ffmpeg / ffprobe / python and inject their paths into the
  // engine, but ONLY if the resolved binary actually works on this host.
  // A returning user with a stale x64 `<binDir>/ffmpeg` on an arm64 Mac
  // without Rosetta would otherwise boot with the engine path pointing
  // at a binary that EBADARCHs on first record — silently, before the
  // wizard or Settings ever runs. The shared `resolveAndValidate` helper
  // does arch + verifyExec validation for app-managed binaries and
  // returns `injectable: false` when validation fails. System-PATH
  // binaries (Homebrew etc.) are still always injected — same posture as
  // before this validation existed; we don't spawn unknown system
  // binaries (Phase 2).
  try {
    const ffmpegRes = await resolveAndValidate("ffmpeg");
    if (ffmpegRes.injectable && ffmpegRes.path) setFfmpegPath(ffmpegRes.path);
    const ffprobeRes = await resolveAndValidate("ffprobe");
    if (ffprobeRes.injectable && ffprobeRes.path) setFfprobePath(ffprobeRes.path);
    // App-managed Python is installed by the Parakeet auto-chain. If
    // it's already present from a previous wizard run, inject the path
    // so engine/setupAsr can build the venv against it without re-doing
    // the install. Falls back to bare "python3" via PATH for CLI/dev
    // when no app-managed runtime exists.
    const pythonRes = await resolveAndValidate("python");
    if (pythonRes.injectable && pythonRes.path) setPythonPath(pythonRes.path);
  } catch {
    // Non-fatal: engine falls back to bare "ffmpeg"/"ffprobe"/"python3" via PATH.
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
    // Embedding-model pull was previously triggered here on every
    // launch. Removed in v0.1.9 — see the comment block at
    // `ensureMeetingIndexEmbeddingModel` (now deleted) for the
    // rationale. The model installs only via the wizard's explicit
    // "Download embedding model" row.
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
