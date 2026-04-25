/**
 * Generic per-tool installer entry point.
 *
 * The wizard's "Install ffmpeg" / "Install Ollama" buttons all flow
 * through here:
 *
 *   1. Look up the manifest entry for (tool, current arch).
 *   2. If no entry exists, return a clear "not supported on this
 *      platform" failure — never download something that wasn't
 *      explicitly pinned in the manifest.
 *   3. Hand off to `downloadAndStage` for the actual fetch + verify
 *      + atomic move + verifyExec lifecycle.
 *
 * Per-tool nuance lives entirely in the manifest, not in code paths
 * here. Adding a new tool means adding an entry to TOOL_MANIFEST and
 * (for the IPC handler) extending the DepsInstallTarget union — no
 * new install logic.
 */
import { findManifestEntry, type ToolName } from "./manifest.js";
import {
  downloadAndStage,
  type DownloadAndStageResult,
  type Fetcher,
  type InstallerProgressEvent,
} from "./download.js";

export interface InstallToolOptions {
  tool: ToolName;
  onProgress?: (event: InstallerProgressEvent) => void;
  /** Test seam — production omits. */
  fetcher?: Fetcher;
  /** Optional cancellation. */
  signal?: AbortSignal;
}

export type InstallToolResult =
  | DownloadAndStageResult
  | {
      ok: false;
      phase: "manifest";
      error: string;
    };

/** Install a tool by manifest lookup. Never throws. */
export async function installTool(
  options: InstallToolOptions
): Promise<InstallToolResult> {
  const entry = findManifestEntry(options.tool);
  if (!entry) {
    const archMsg =
      process.arch === "arm64" || process.arch === "x64"
        ? `no manifest entry for ${options.tool} on darwin/${process.arch} yet`
        : `${options.tool} is not supported on ${process.platform}/${process.arch}`;
    options.onProgress?.({
      tool: options.tool,
      phase: "failed",
      error: archMsg,
    });
    return { ok: false, phase: "manifest", error: archMsg };
  }

  return await downloadAndStage({
    entry,
    onProgress: options.onProgress,
    fetcher: options.fetcher,
    signal: options.signal,
  });
}

export { type Fetcher, type InstallerProgressEvent } from "./download.js";
