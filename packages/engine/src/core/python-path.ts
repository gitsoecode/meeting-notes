/**
 * Resolved Python interpreter path. Mirrors `ffmpeg-path.ts`.
 *
 * The Electron host installs an app-managed Python runtime via the wizard
 * and calls `setPythonPath(absolutePath)` on startup (and after install)
 * so engine-internal venv builds use the explicit path. Default falls
 * back to "python3" so the standalone CLI still works against system
 * Python.
 */
let resolvedPath = "python3";

export function setPythonPath(path: string): void {
  if (path && path.length > 0) resolvedPath = path;
}

export function getPythonPath(): string {
  return resolvedPath;
}
