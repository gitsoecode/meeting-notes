/**
 * Resolved ffmpeg path. The CLI binary uses bare "ffmpeg" (PATH lookup),
 * which is fine for terminal launches but breaks for the packaged Electron
 * app — GUI launches inherit a stripped PATH that misses Homebrew prefixes.
 *
 * The host (main process) should call `setFfmpegPath(absolutePath)` once at
 * startup, after resolving the binary via its own resolver. Engine-internal
 * spawns then use the explicit path instead of relying on PATH lookup.
 *
 * Default falls back to "ffmpeg" so the standalone CLI still works.
 */
let resolvedPath = "ffmpeg";

export function setFfmpegPath(path: string): void {
  if (path && path.length > 0) resolvedPath = path;
}

export function getFfmpegPath(): string {
  return resolvedPath;
}
