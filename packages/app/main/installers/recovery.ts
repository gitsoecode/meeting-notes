/**
 * Pure (electron-free) recovery helpers for the kept-`.prev` transactional
 * install pattern.
 *
 * Lives in its own module so unit tests can import it under plain Node
 * without booting Electron — the equivalent helpers re-exported from
 * `download.ts` go through `paths.ts` which `import { app } from "electron"`,
 * which throws outside the main process.
 *
 * Production wrappers in `download.ts` resolve `binDir()` once and forward
 * to these functions. Tests pass an explicit tmpdir.
 */
import fs from "node:fs";
import path from "node:path";
import type { ToolManifestEntry } from "./manifest.js";

/** Force-remove file or directory if present. Never throws. */
function rmSilent(target: string): void {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

/**
 * Pure: does an orphaned `<tool>-runtime.prev` exist at `binDirPath`?
 * Used to detect transactions left in flight by an interrupted run.
 * No-op for single-binary layouts.
 */
export function hasOrphanedKeptPrevAt(
  binDirPath: string,
  entry: ToolManifestEntry
): boolean {
  if (entry.installLayout !== "preserve-tree") return false;
  return fs.existsSync(path.join(binDirPath, `${entry.tool}-runtime.prev`));
}

/**
 * Pure: delete the kept `.prev` after a transaction commits. Idempotent.
 * No-op for single-binary.
 */
export function commitKeptPrevAt(
  binDirPath: string,
  entry: ToolManifestEntry
): void {
  if (entry.installLayout !== "preserve-tree") return;
  rmSilent(path.join(binDirPath, `${entry.tool}-runtime.prev`));
}

/**
 * Pure: restore the kept `.prev` runtime to canonical and recreate the
 * canonical symlink. Used by both the in-flight transaction rollback
 * (Parakeet venv smoke fails) and the mid-swap crash recovery
 * (canonical missing on entry, `.prev` is the only known-good copy).
 *
 * Critical invariant: this MUST work when the canonical runtime is
 * missing. If we move-aside-then-rename without that branch, an
 * interrupted swap leaves no recovery path.
 */
export function rollbackKeptPrevAt(
  binDirPath: string,
  entry: ToolManifestEntry
): void {
  if (entry.installLayout !== "preserve-tree") return;
  const runtime = path.join(binDirPath, `${entry.tool}-runtime`);
  const prevRuntime = runtime + ".prev";
  const finalPath = path.join(binDirPath, entry.tool);

  if (fs.existsSync(prevRuntime)) {
    // Move the (possibly broken) new runtime aside if it exists. If
    // canonical is missing entirely (mid-swap crash), skip the
    // move-aside and rename `.prev` straight into place.
    const brokenAside = runtime + ".broken";
    rmSilent(brokenAside);
    if (fs.existsSync(runtime)) {
      try {
        fs.renameSync(runtime, brokenAside);
      } catch {
        // If we can't move the new one aside we can't continue safely.
        return;
      }
    }
    try {
      fs.renameSync(prevRuntime, runtime);
      // Recreate the canonical symlink at the previous-version target.
      // Same rel-symlink shape as the install path uses.
      rmSilent(finalPath);
      const relTarget = path.join(
        `${entry.tool}-runtime`,
        entry.binaryPathInArchive
      );
      fs.symlinkSync(relTarget, finalPath);
    } catch {
      // Restore failed mid-flight — best-effort, leave the broken aside
      // and bail. User will see the issue on next launch via depsCheck.
    } finally {
      rmSilent(brokenAside);
    }
  } else {
    // No .prev — discard the just-installed runtime entirely.
    rmSilent(runtime);
    rmSilent(finalPath);
  }
}
