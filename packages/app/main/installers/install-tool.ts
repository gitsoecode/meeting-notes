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
import fs from "node:fs";
import path from "node:path";
import { findManifestEntry, type ToolName } from "./manifest.js";
import { binDir } from "../paths.js";
import { runVerifyExec } from "./verifyExec.js";
import { hasOrphanedKeptPrevAt } from "./recovery.js";
import { isHostArchBinary } from "./arch.js";
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
  /**
   * Preserve the previous runtime at `<binDir>/<tool>-runtime.prev` for
   * a downstream transaction to commit or roll back. See `commitKeptPrev`
   * / `rollbackKeptPrev` in `download.ts`. Used by the Parakeet chain
   * to coordinate Python-runtime + venv as one transaction.
   */
  keepPrev?: boolean;
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
    keepPrev: options.keepPrev,
  });
}

/**
 * Look up the manifest entry for a tool by name. Re-exported here so
 * orchestrators (e.g. the setup-asr IPC handler) can pass the entry
 * straight into `commitKeptPrev` / `rollbackKeptPrev` after they call
 * `installTool` — without those helpers needing to look it up again.
 */
export function findEntry(tool: ToolName) {
  return findManifestEntry(tool);
}

/**
 * "Does an orphaned `.prev` runtime exist for `tool`?" — used by the
 * Parakeet auto-chain to detect an in-flight transaction left behind
 * by a previous run that was killed between Python install and venv
 * commit/rollback. When this returns true, the caller should treat
 * the chain as having an outstanding Python transaction: a successful
 * venv build commits (deletes `.prev`); a failed venv build rolls
 * back (restores the previous runtime from `.prev`). Without this
 * check, an orphaned `.prev` would leak forever and the next failure
 * would silently bypass the rollback because `pythonInstallNeedsCommit`
 * was false.
 *
 * No-op for single-binary layouts (we don't keep `.prev` for those).
 */
export function hasOrphanedKeptPrev(tool: ToolName): boolean {
  const entry = findManifestEntry(tool);
  if (!entry) return false;
  return hasOrphanedKeptPrevAt(binDir(), entry);
}

/**
 * "Is the manifest-pinned version of `tool` already installed in
 * `<binDir>/<tool>`?" — used by orchestrators to decide whether to
 * call `installTool` or skip.
 *
 * Critically, this **does NOT** fall back to system PATH like
 * `resolveBin` does. The Parakeet chain (and any other consumer that
 * needs a known-version, app-managed binary) must NOT accept whatever
 * `python3` happens to be on PATH — that re-introduces the
 * "works because the dev had Python installed" class of bug. For
 * Python specifically, the system copy may be the wrong arch (Intel
 * Python on Apple Silicon), wrong major version, or otherwise
 * incompatible with the venv we want to build against the pinned
 * runtime.
 *
 * Implementation: existence-check the symlink/binary at `<binDir>/<tool>`,
 * run it with the manifest's `verifyExec.args`, and parse the version
 * from stdout/stderr. Compare against `entry.version`. Any miss means
 * "install needed" and the caller should call `installTool` to either
 * install fresh or upgrade in place (with `keepPrev: true` if the
 * caller wants transactional rollback).
 *
 * Returns `false` when the tool is missing, when the version doesn't
 * match, when verifyExec fails, or when verifyExec output doesn't
 * contain a parseable version. Treat any false as "install needed."
 */
export async function isPinnedVersionInstalled(
  tool: ToolName
): Promise<boolean> {
  const entry = findManifestEntry(tool);
  if (!entry) return false;

  const candidate = path.join(binDir(), tool);
  if (!fs.existsSync(candidate)) return false;

  // Arch validation FIRST: if the on-disk binary's Mach-O arch doesn't
  // match the host, skip the verifyExec spawn entirely. Spawning a
  // wrong-arch binary on a host without Rosetta returns EBADARCH (libuv
  // -86) and on some Node versions throws synchronously rather than
  // emitting `'error'` — see the unit test in test/install-bundle.test.mjs
  // for the regression guarantee. Returning false here triggers a fresh
  // install that will replace the wrong-arch binary.
  if (!(await isHostArchBinary(candidate))) {
    return false;
  }

  // Run the manifest's verifyExec args (e.g., `python -V`, `ffmpeg -version`)
  // and look for the manifest's pinned version string in the output.
  // Defensive try/catch: even though runVerifyExec returns a structured
  // result for spawn errors, we wrap to guarantee the helper never throws
  // out — `isPinnedVersionInstalled` is a "should we install?" probe and
  // a thrown error here would leak into `installFfmpegBundle` / the
  // setup-asr chain as an unstructured failure.
  let verifyResult;
  try {
    verifyResult = await runVerifyExec(candidate, entry.verifyExec);
  } catch {
    return false;
  }
  if (!verifyResult.ok) return false;

  // Match the manifest version *bounded* by non-version characters so
  // "3.12.13" doesn't accidentally match "3.12.131". Also tolerate the
  // common "<name> <version>" output shape (Python 3.12.13, ffmpeg
  // version 7.1.1, ollama version is 0.21.2).
  const pattern = new RegExp(
    `(^|[^\\d.])${entry.version.replace(/\./g, "\\.")}([^\\d.]|$)`
  );
  return pattern.test(verifyResult.output);
}

export { type Fetcher, type InstallerProgressEvent } from "./download.js";
