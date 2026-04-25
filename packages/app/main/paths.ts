/**
 * Path contract for Electron-managed app storage.
 *
 * MAIN PROCESS ONLY — the renderer must never import this module.
 * The renderer asks main via IPC for any path it needs to display.
 * Importing `app` from "electron" outside the main process throws.
 *
 * Scope split with the engine:
 * - User-content paths (config, prompts, parakeet venv, ollama models,
 *   audio recordings) are owned by `@gistlist/engine` via
 *   `getConfigDir()` / `~/.gistlist/`. The override there is
 *   `GISTLIST_CONFIG_DIR` and stays the engine's contract.
 * - This module owns Electron-managed app state only: wizard-installed
 *   binaries, in-flight downloads, and electron-updater state.
 *
 * `binDir()` and `downloadStageDir()` deliberately live under the same
 * `userDataDir()` root — `fs.renameSync` is only POSIX-atomic when source
 * and destination share a volume, so co-locating them lets the installer
 * stage a download then atomically move into bin once verified.
 *
 * Test override: setting `GISTLIST_USER_DATA_DIR=/some/temp/dir` before
 * the app boots redirects everything below. Read once on first call and
 * cached — subsequent env mutations within a session are ignored.
 */
import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  binDirOf,
  downloadStageDirOf,
  resolveUserDataDir,
  updaterStateDirOf,
} from "./paths-core.js";

let cachedRoot: string | null = null;

/** Root of Electron-managed app state. Cached after first call. */
export function userDataDir(): string {
  if (cachedRoot !== null) return cachedRoot;
  cachedRoot = resolveUserDataDir(app.getPath("userData"));
  return cachedRoot;
}

/**
 * Where wizard-installed binaries live. The resolver in `bundled.ts`
 * checks this first when it needs ffmpeg/ollama/whisper-cli, falling
 * back to `process.resourcesPath/bin` (legacy bundled) and finally
 * system PATH.
 */
export function binDir(): string {
  return binDirOf(userDataDir());
}

/**
 * Staging dir for in-flight downloads. The installer writes here, hashes
 * during write, verifies SHA-256, and only then atomically renames into
 * `binDir()`. Anything that lands in `binDir()` is by construction a
 * verified, executable binary — the resolver never sees half-downloads.
 */
export function downloadStageDir(): string {
  return downloadStageDirOf(userDataDir());
}

/** electron-updater scratch space (downloaded update artifacts, etc.). */
export function updaterStateDir(): string {
  return updaterStateDirOf(userDataDir());
}

/**
 * The directory the "Reveal logs in Finder" button opens. Points at the
 * engine's `~/.gistlist/` because that's where the user-meaningful logs
 * live (`app.log`, `ollama.log`). Electron's own `app.getPath("logs")`
 * dir contains chromium internals that aren't useful for support email
 * triage. We intentionally point users at the engine logs.
 */
export function logsDir(): string {
  // Mirror the engine's `getConfigDir()` contract: prefer GISTLIST_CONFIG_DIR
  // when set (so smoke tests stay isolated), otherwise ~/.gistlist.
  const envDir = process.env.GISTLIST_CONFIG_DIR;
  if (envDir && envDir.trim().length > 0) return envDir.trim();
  return path.join(os.homedir(), ".gistlist");
}

/**
 * Ensure a directory exists. Returns the path for chaining:
 *   const dir = ensureDir(binDir());
 * Uses `recursive: true` so it's safe to call repeatedly.
 */
export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Test-only: reset the cache so a different override can be picked up. */
export function __resetCacheForTests(): void {
  cachedRoot = null;
}
