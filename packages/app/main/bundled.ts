import path from "node:path";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { app } from "electron";
import { fileURLToPath } from "node:url";
import { binDir } from "./paths.js";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Binaries the app cares about resolving at runtime. Wizard-installed
 * (Phase 2 onward) — except for AudioTee and mic-capture, which are
 * bundled inside the .app and have their own dedicated resolvers.
 */
export type BinName = "ollama" | "ffmpeg" | "whisper-cli";
export type BinSource = "app-installed" | "bundled" | "system";

export interface ResolvedBin {
  path: string;
  source: BinSource;
}

/**
 * Resolution order:
 *
 *   1. `<userData>/bin/<name>` — the wizard installer's output. Preferred
 *      because we own the version (manifest-pinned), the build variant,
 *      and the signature. After the user has explicitly opted in to a
 *      "clean copy" install, this beats whatever's on PATH.
 *
 *   2. `Contents/Resources/bin/<name>` — anything we ship inside the
 *      .app bundle. Legacy path; only AudioTee and mic-capture really
 *      use this today, and ollama is no longer bundled here. Kept so
 *      mid-development builds with locally-staged binaries still work.
 *
 *   3. System PATH — the user's existing Homebrew or manual install.
 *      Surfaced in the wizard with a "Use a clean copy" affordance so
 *      the user knows where the binary's coming from.
 *
 * Returns null when the binary can't be found anywhere.
 */
export async function resolveBin(name: BinName): Promise<ResolvedBin | null> {
  // 1. App-installed (wizard download path).
  const appInstalled = path.join(binDir(), name);
  if (isExecutableFile(appInstalled)) {
    return { path: appInstalled, source: "app-installed" };
  }

  // 2. Bundled inside the .app (legacy / dev shim).
  const bundled = bundledBin(name);
  if (isExecutableFile(bundled)) {
    return { path: bundled, source: "bundled" };
  }

  // 3. System PATH.
  const systemPath = await whichCmd(name);
  if (systemPath && isExecutableFile(systemPath)) {
    return { path: systemPath, source: "system" };
  }

  return null;
}

/**
 * Resolves a binary that ships inside `packages/app/resources/bin/<name>`
 * (dev) or `Contents/Resources/bin/<name>` (packaged). Returns the
 * absolute path even if the file does not exist on disk — callers
 * should verify with `fs.existsSync` (or the helpers below) if they care.
 *
 * Kept around because some callers want to know "is the bundled copy
 * present?" specifically, separate from the broader resolution order.
 */
export function bundledBin(name: BinName): string {
  if (app.isPackaged) {
    // process.resourcesPath = .../Gistlist.app/Contents/Resources
    return path.join(process.resourcesPath, "bin", name);
  }
  // Dev: walk up from dist/main/ to packages/app/resources/bin/.
  // __dirname is dist/main/ at runtime, so ../../resources/bin works.
  return path.resolve(__dirname, "../../resources/bin", name);
}

export function bundledBinExists(name: BinName): boolean {
  return isExecutableFile(bundledBin(name));
}

/**
 * Well-known macOS install prefixes we probe directly when `which` comes
 * up empty. Even with the startup PATH augmentation in main/index.ts, this
 * is a belt-and-suspenders fallback for non-default Homebrew prefixes,
 * unusual launchers, and CLI invocations that bypass the GUI startup path.
 */
const DARWIN_FALLBACK_PREFIXES = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/opt/local/bin",
];

/**
 * `which` wrapper. Promoted out of ipc.ts so installers and the
 * resolver don't have to duplicate the spawn boilerplate. Returns
 * null on any failure (no system `which`, command not found, etc.).
 *
 * On macOS, falls back to probing well-known Homebrew/MacPorts prefixes
 * before giving up — packaged apps can have a stripped PATH that misses
 * these even when the binary is installed.
 */
export async function whichCmd(cmd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("/usr/bin/env", ["which", cmd]);
    const trimmed = stdout.trim();
    if (trimmed.length > 0) return trimmed;
  } catch {
    /* fall through to absolute-path probe */
  }
  if (process.platform === "darwin") {
    for (const prefix of DARWIN_FALLBACK_PREFIXES) {
      const candidate = path.join(prefix, cmd);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}

/** True when the file exists, is a regular file, and has any executable bit set. */
function isExecutableFile(p: string): boolean {
  try {
    const st = fs.statSync(p);
    return st.isFile() && (st.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}
