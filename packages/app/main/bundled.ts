import path from "node:path";
import fs from "node:fs";
import { app } from "electron";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolves a binary that ships inside `packages/app/resources/bin/<name>`
 * (dev) or `Contents/Resources/bin/<name>` (packaged). Returns the absolute
 * path even if the file does not exist on disk — callers should verify
 * with `fs.existsSync` if they care. In normal development these files may
 * be absent entirely; release packaging injects them out of band before
 * electron-builder runs.
 *
 * Naming this `bundledBin` (rather than e.g. `binPath`) on purpose so it's
 * obvious in the call site that this resource is shipped *inside* the app
 * — there is no fallback to the user's PATH.
 */
export type BundledBinary = "ollama" | "ffmpeg";

export function bundledBin(name: BundledBinary): string {
  if (app.isPackaged) {
    // process.resourcesPath = .../Meeting Notes.app/Contents/Resources
    return path.join(process.resourcesPath, "bin", name);
  }
  // Dev: walk up from dist/main/ to packages/app/resources/bin/
  // __dirname is dist/main/ at runtime, so ../../resources/bin works.
  return path.resolve(__dirname, "../../resources/bin", name);
}

export function bundledBinExists(name: BundledBinary): boolean {
  try {
    return fs.statSync(bundledBin(name)).isFile();
  } catch {
    return false;
  }
}
