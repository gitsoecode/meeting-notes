/**
 * Pure path-resolution helpers — no Electron imports, no node:fs side
 * effects. Lives in its own module so unit tests can exercise the
 * env-var override logic without booting Electron's `app` module.
 *
 * The Electron-aware wrappers in `paths.ts` pull `app.getPath("userData")`
 * as the production fallback and forward to these helpers.
 */
import path from "node:path";

/**
 * Resolve the userData root, honoring `GISTLIST_USER_DATA_DIR` when set.
 *
 * - Empty / whitespace-only override values are ignored (treated as unset).
 * - The override is read once per call; callers are expected to cache the
 *   result for the session if they care about consistency under env mutation.
 *
 * Used by the smoke spec (which spawns the built app with
 * `GISTLIST_USER_DATA_DIR=$(mktemp -d)`) so tests never touch the real
 * `~/Library/Application Support/Gistlist`.
 */
export function resolveUserDataDir(
  fallback: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const override = env.GISTLIST_USER_DATA_DIR;
  if (override && override.trim().length > 0) return override.trim();
  return fallback;
}

/** Subdir that holds wizard-installed binaries (ffmpeg, ollama, whisper-cli). */
export function binDirOf(userDataDir: string): string {
  return path.join(userDataDir, "bin");
}

/** Subdir for in-flight downloads — atomically renamed into binDir on success. */
export function downloadStageDirOf(userDataDir: string): string {
  return path.join(userDataDir, "downloads");
}

/** Subdir for electron-updater state (downloaded artifacts, version cache). */
export function updaterStateDirOf(userDataDir: string): string {
  return path.join(userDataDir, "updater");
}
