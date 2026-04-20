import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

/**
 * Resolve which `audiotee` binary to spawn.
 *
 * macOS TCC attributes permission requests to the "responsible process",
 * which for a helper spawned by an app is determined by where the helper
 * lives. If we spawn the stock `node_modules/audiotee/bin/audiotee` binary
 * it's treated as its *own* app (separate bundle identity, separate TCC
 * entry, permissions impossible to grant through System Settings), and
 * AudioTee will silently stream zero bytes.
 *
 * The fix is to run the audiotee binary that the `patch-audiotee.mjs`
 * script has copied into `Electron.app/Contents/MacOS/audiotee` and
 * re-signed with the `com.apple.security.inherit` entitlement. Then the
 * helper inherits TCC responsibility from the parent Electron process, and
 * the user's "System Audio Recording Only" grant for Electron (in dev) or
 * Gistlist (in prod) is what macOS checks.
 *
 * Returns `undefined` if the bundled helper isn't found — AudioTee will
 * then fall back to its default (stock npm binary). That path records
 * zeros until the patch script has been run.
 */
export function resolveAudioTeeBinary(): string | undefined {
  try {
    // In both dev and packaged builds, process.execPath is the main Electron
    // executable (.../Contents/MacOS/Electron). The patched audiotee is a
    // sibling of that executable inside the same bundle.
    const candidate = path.resolve(process.execPath, "..", "audiotee");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  } catch {
    // ignore
  }
  // Packaged builds may also expose it via Resources/.
  try {
    const resourcesCandidate = path.join(app.getPath("userData"), "..", "audiotee");
    if (fs.existsSync(resourcesCandidate)) {
      return resourcesCandidate;
    }
  } catch {
    // ignore
  }
  return undefined;
}
