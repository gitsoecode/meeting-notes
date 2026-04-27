/**
 * Resolved ffprobe path. Symmetric to ffmpeg-path.ts — the host (main
 * process) calls setFfprobePath() at startup with the absolute path
 * resolveBin("ffprobe") returned, and engine-internal spawns then use
 * that explicit path instead of relying on PATH lookup. Standalone CLI
 * usage falls back to bare "ffprobe" via the user's shell PATH.
 *
 * Why this exists separately from ffmpeg-path: the wizard installer
 * downloads ffmpeg and ffprobe as a paired unit (evermeet.cx ships them
 * separately) and they may resolve to different locations if the user
 * has, e.g., system ffmpeg via Homebrew but is missing ffprobe.
 */
let resolvedPath = "ffprobe";

export function setFfprobePath(path: string): void {
  if (path && path.length > 0) resolvedPath = path;
}

export function getFfprobePath(): string {
  return resolvedPath;
}
