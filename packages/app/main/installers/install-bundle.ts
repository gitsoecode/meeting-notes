/**
 * ffmpeg + ffprobe paired installer.
 *
 * Both binaries come from the same evermeet.cx LGPL static-build family
 * and are required together — engine/audio.ts uses ffprobe for stream
 * info and would silently fail if it were missing while ffmpeg was
 * present. This helper is the single source of truth for installing the
 * pair so the `deps:install` IPC handler and the new Parakeet auto-chain
 * never drift apart.
 *
 * **Scoped rollback semantics.** A pair-install can land in three states:
 *
 *   - both already present → no-op, returns ok.
 *   - only one present → install just the other; rollback only removes
 *     binaries this invocation wrote.
 *   - neither present → install both sequentially; if the second fails,
 *     remove the first (which we just installed).
 *
 * Critically, we never delete a binary that was already on disk before
 * this call. A user with a working ffmpeg from a prior wizard run who
 * triggers a Parakeet install that fails on ffprobe must keep their
 * ffmpeg. The `installedThisRun` set tracks exactly which binaries we
 * own and is the only thing rollback consults.
 */
import fs from "node:fs";
import path from "node:path";
import { binDir } from "../paths.js";
import { installTool, isPinnedVersionInstalled } from "./install-tool.js";
import type { InstallerPhase, InstallerProgressEvent } from "./download.js";

export interface InstallFfmpegBundleOptions {
  onProgress?: (event: InstallerProgressEvent) => void;
  signal?: AbortSignal;
}

export type InstallFfmpegBundleResult =
  | { ok: true; installed: ("ffmpeg" | "ffprobe")[] }
  | { ok: false; phase: InstallerPhase | "manifest"; error: string };

/** Forcibly remove a binary we wrote during this run. Never fails. */
function removeAppInstalled(tool: "ffmpeg" | "ffprobe"): void {
  try {
    fs.rmSync(path.join(binDir(), tool), { force: true });
  } catch {
    /* best-effort */
  }
}

export async function installFfmpegBundle(
  options: InstallFfmpegBundleOptions = {}
): Promise<InstallFfmpegBundleResult> {
  const installedThisRun: ("ffmpeg" | "ffprobe")[] = [];

  // Check current state via `isPinnedVersionInstalled`, which checks
  // ONLY <binDir>/<tool> (not system PATH) AND validates Mach-O arch
  // matches the host. Three reasons this differs from the older
  // `resolveBin`-based check:
  //
  //   1. A wrong-arch app-installed binary (e.g. an x64 ffmpeg left
  //      over from a prior install on a host that's now arm64-without-
  //      Rosetta) would pass `resolveBin` but not `isHostArchBinary`,
  //      so the install proceeds and replaces it. Without this, the
  //      Parakeet auto-chain fails on the Tink.aiff smoke test with
  //      EBADARCH (libuv -86) — exactly the UTM regression.
  //   2. A system ffmpeg from Homebrew would short-circuit the bundle
  //      via `resolveBin`, leaving the Parakeet chain dependent on a
  //      binary we didn't install and can't guarantee. The chain's own
  //      `injection` step still resolves to the system path for the
  //      *engine's* recording code (which is fine — engine recording
  //      is permissive), but the Parakeet venv's smoke test runs
  //      against `<binDir>/ffmpeg` specifically, so we need the
  //      pinned binary on disk regardless of system PATH state.
  //   3. The version pin gets re-verified, so a manifest bump triggers
  //      an upgrade install instead of silently keeping the old
  //      version.
  const ffmpegPinned = await isPinnedVersionInstalled("ffmpeg");
  const ffprobePinned = await isPinnedVersionInstalled("ffprobe");
  if (ffmpegPinned && ffprobePinned) {
    return { ok: true, installed: [] };
  }

  // Install whichever side(s) are missing. Order: ffmpeg first, then
  // ffprobe, so a partial-failure rollback path is straightforward.
  if (!ffmpegPinned) {
    const r = await installTool({
      tool: "ffmpeg",
      onProgress: options.onProgress,
      signal: options.signal,
    });
    if (!r.ok) {
      return { ok: false, phase: r.phase, error: r.error };
    }
    installedThisRun.push("ffmpeg");
  }

  if (!ffprobePinned) {
    const r = await installTool({
      tool: "ffprobe",
      onProgress: options.onProgress,
      signal: options.signal,
    });
    if (!r.ok) {
      // Rollback only what we wrote. ffmpeg installed in *this run*
      // gets removed; a pre-existing ffmpeg stays untouched.
      for (const tool of installedThisRun) {
        removeAppInstalled(tool);
      }
      return { ok: false, phase: r.phase, error: r.error };
    }
    installedThisRun.push("ffprobe");
  }

  return { ok: true, installed: installedThisRun };
}
