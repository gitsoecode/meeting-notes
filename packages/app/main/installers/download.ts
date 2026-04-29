/**
 * Wizard-installer download + stage + verify + atomic-move pipeline.
 *
 * Lifecycle for a single tool:
 *
 *   1. Clear any prior staged files for this (tool, version).
 *   2. Stream the URL through a SHA-256 hasher into the stage dir.
 *   3. Verify the digest matches `entry.sha256` exactly.
 *   4. Extract (tgz/zip) if archive, or skip for raw single-file downloads.
 *   5. Run `codesign --verify --deep --strict` when `signatureCheck` requires it.
 *   6. Atomic-rename the resolved binary from stage → binDir() (same volume,
 *      so POSIX rename is atomic — no half-installed state ever visible to
 *      the resolver).
 *   7. `verifyExec` runs the binary in a constrained subprocess (no shell,
 *      sanitized env, hard timeout). If it fails, the binary is removed
 *      from binDir() so the resolver can't see a broken executable.
 *
 * On any failure: stage dir for this tool is purged, binDir() never gains
 * a file. The wizard re-entry shows "Retry" with the failing phase named.
 *
 * Test injection (`fetcher` arg): swap in a faulty stream — failing reads,
 * hash-mismatched bytes, hung readers — without monkey-patching node:https.
 * Production callers omit it; the default fetcher follows redirects via
 * node:https / node:http.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { spawn } from "node:child_process";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { binDir, downloadStageDir, ensureDir } from "../paths.js";
import type { ToolManifestEntry } from "./manifest.js";
import { runVerifyExec } from "./verifyExec.js";
import { stripQuarantineXattr } from "./xattr.js";

export type InstallerPhase =
  | "download"
  | "verify-checksum"
  | "extract"
  | "verify-signature"
  | "verify-exec"
  | "complete"
  | "failed";

export interface InstallerProgressEvent {
  tool: string;
  phase: InstallerPhase;
  /** Bytes seen so far (download phase only). */
  bytesDone?: number;
  /** Total bytes — when content-length was known. May be undefined. */
  bytesTotal?: number;
  /** Set on phase: "failed". A short message suitable for the UI. */
  error?: string;
}

/**
 * Test seam. Returns a Readable stream of bytes plus an optional
 * content-length so the progress callback can report bytesTotal.
 * The default implementation follows redirects.
 */
export type Fetcher = (
  url: string,
  signal?: AbortSignal
) => Promise<{ stream: NodeJS.ReadableStream; contentLength: number | null }>;

export interface DownloadAndStageOptions {
  entry: ToolManifestEntry;
  onProgress?: (event: InstallerProgressEvent) => void;
  /** Optional override — production callers omit. */
  fetcher?: Fetcher;
  /** Optional cancellation. */
  signal?: AbortSignal;
  /**
   * Body-stream inactivity timeout in ms. Production omits and gets
   * DEFAULT_BODY_INACTIVITY_MS (60 s). Tests inject a small value
   * (e.g. 100 ms) so the stalled-stream path can be exercised without
   * waiting the real timeout.
   */
  bodyInactivityMs?: number;
  /**
   * Preserve the previous runtime at `<binDir>/<tool>-runtime.prev` after
   * the atomic swap (preserve-tree only — no-op for single-binary). The
   * caller is then responsible for either calling `commitKeptPrev(entry)`
   * after a downstream success or `rollbackKeptPrev(entry)` after a
   * downstream failure. Used by the Parakeet auto-chain to coordinate
   * Python-runtime + venv as one transaction so a venv smoke-test
   * failure can roll Python back to the previous version.
   */
  keepPrev?: boolean;
}

export type DownloadAndStageResult =
  | { ok: true; finalPath: string }
  | { ok: false; phase: InstallerPhase; error: string };

/**
 * Default fetcher — node:https with redirect following (max 5 hops).
 * Times out the *initial connection*, not the body stream (large
 * downloads may legitimately take minutes).
 */
export const httpsFetcher: Fetcher = async (url, signal) => {
  return await fetchWithRedirects(url, 5, signal);
};

function fetchWithRedirects(
  url: string,
  redirectsLeft: number,
  signal: AbortSignal | undefined
): Promise<{ stream: NodeJS.ReadableStream; contentLength: number | null }> {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith("https:") ? https : http;
    const req = proto.get(url, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        if (redirectsLeft <= 0) {
          res.resume();
          return reject(new Error(`Too many redirects starting at ${url}`));
        }
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        return fetchWithRedirects(next, redirectsLeft - 1, signal).then(
          resolve,
          reject
        );
      }
      if (status !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${status} for ${url}`));
      }
      const contentLengthHeader = res.headers["content-length"];
      const contentLength = contentLengthHeader
        ? Number.parseInt(String(contentLengthHeader), 10)
        : null;
      resolve({ stream: res, contentLength: Number.isFinite(contentLength) ? (contentLength as number) : null });
    });
    req.on("error", reject);
    // Connection-level timeout only. Body streams may run for minutes.
    req.setTimeout(30_000, () => {
      req.destroy(new Error(`Connection timeout (30s) connecting to ${url}`));
    });
    if (signal) {
      const onAbort = () => req.destroy(new Error("aborted"));
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/** Stage filename — namespaces by tool+version so concurrent reinstalls don't collide. */
function stageFileFor(entry: ToolManifestEntry): string {
  const ext =
    entry.archiveType === "tgz"
      ? ".tgz"
      : entry.archiveType === "zip"
        ? ".zip"
        : "";
  return path.join(downloadStageDir(), `${entry.tool}-${entry.version}${ext}`);
}

/** Extracted contents dir — subdir of stage so atomic rename stays same-volume. */
function extractDirFor(entry: ToolManifestEntry): string {
  return path.join(
    downloadStageDir(),
    `${entry.tool}-${entry.version}-extracted`
  );
}

/** Force-remove file or directory if present. Never throws. */
function rmSilent(target: string): void {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

/**
 * Default body-stream inactivity timeout. The connection-level setTimeout
 * (in the fetcher) only catches a stalled *connect*; once bytes start
 * flowing, a server can stall mid-stream forever. If no bytes arrive for
 * this long, fail in the `download` phase instead of spinning silently.
 *
 * Overridable via DownloadAndStageOptions.bodyInactivityMs (used by tests
 * with a much shorter value so they don't wait the real 60 s).
 */
const DEFAULT_BODY_INACTIVITY_MS = 60_000;

/** Stream a source into a write target while updating a hasher. */
async function streamToFileWithHash(
  source: NodeJS.ReadableStream,
  destPath: string,
  contentLength: number | null,
  onProgress: ((bytesDone: number, bytesTotal: number | null) => void) | null,
  signal: AbortSignal | undefined,
  inactivityMs: number
): Promise<{ sha256: string; bytes: number }> {
  const hasher = crypto.createHash("sha256");
  const out = fs.createWriteStream(destPath);
  let bytes = 0;

  return await new Promise<{ sha256: string; bytes: number }>((resolve, reject) => {
    let inactivityTimer: NodeJS.Timeout | null = null;
    const armInactivity = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        cleanup();
        out.destroy();
        if ("destroy" in source && typeof (source as { destroy?: () => void }).destroy === "function") {
          (source as { destroy: () => void }).destroy();
        }
        reject(new Error(`stalled: no data received for ${inactivityMs}ms`));
      }, inactivityMs);
    };
    const cleanup = () => {
      if (inactivityTimer) {
        clearTimeout(inactivityTimer);
        inactivityTimer = null;
      }
      source.removeAllListeners();
      out.removeAllListeners();
    };
    if (signal) {
      const onAbort = () => {
        source.unpipe(out);
        out.destroy(new Error("aborted"));
        cleanup();
        reject(new Error("aborted"));
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    }
    source.on("data", (chunk: Buffer) => {
      hasher.update(chunk);
      bytes += chunk.length;
      if (onProgress) onProgress(bytes, contentLength);
      armInactivity();
    });
    source.on("error", (err) => {
      cleanup();
      out.destroy();
      reject(err);
    });
    out.on("error", (err) => {
      cleanup();
      reject(err);
    });
    out.on("close", () => {
      cleanup();
      resolve({ sha256: hasher.digest("hex"), bytes });
    });
    armInactivity();
    source.pipe(out);
  });
}

/** Spawn `tar -xzf` or `unzip` to extract into extractDirFor(entry). */
async function extractArchive(entry: ToolManifestEntry): Promise<void> {
  const archive = stageFileFor(entry);
  const dest = ensureDir(extractDirFor(entry));

  // Clear any previous extraction — re-runs are routine.
  for (const child of fs.readdirSync(dest)) {
    rmSilent(path.join(dest, child));
  }

  if (entry.archiveType === "tgz") {
    await runProc("tar", ["-xzf", archive, "-C", dest]);
  } else if (entry.archiveType === "zip") {
    // -o overwrite, -q quiet. macOS ships /usr/bin/unzip by default.
    await runProc("unzip", ["-oq", archive, "-d", dest]);
  } else {
    // archiveType === "raw" — caller shouldn't have called us.
    throw new Error(`extractArchive called for raw archiveType (${entry.tool})`);
  }
}

/** Promise-wrapper for spawn — fails on non-zero exit. No shell. */
function runProc(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.trim()}`));
    });
  });
}

/** `codesign --verify --deep --strict` against an extracted binary. */
async function verifySignature(binaryPath: string): Promise<void> {
  await runProc("codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    binaryPath,
  ]);
}

/**
 * Resolve where the executable ends up after extraction.
 *  - archiveType: "raw" → the staged file itself is the binary.
 *  - archiveType: "tgz" | "zip" → joins extractDirFor + binaryPathInArchive.
 */
function resolveExtractedBinary(entry: ToolManifestEntry): string {
  if (entry.archiveType === "raw") return stageFileFor(entry);
  return path.join(extractDirFor(entry), entry.binaryPathInArchive);
}

/** Where preserve-tree installs land. Sibling of the canonical `<tool>` symlink. */
function runtimeDirFor(entry: ToolManifestEntry): string {
  return path.join(binDir(), `${entry.tool}-runtime`);
}

/**
 * Where a new install stages BEFORE swap. The whole point: never delete
 * the user's working install until we've verified the replacement. If
 * download/verify fails, this stage path gets cleaned up and the existing
 * `<tool>` (and `<tool>-runtime` for preserve-tree) is untouched.
 */
function stagedInstallFor(entry: ToolManifestEntry): string {
  return entry.installLayout === "single-binary"
    ? path.join(binDir(), `${entry.tool}.next`)
    : path.join(binDir(), `${entry.tool}-runtime-next`);
}

/**
 * Top-level installer. Returns ok|failure, never throws.
 * onProgress fires for each phase transition (and during download for byte-level updates).
 */
export async function downloadAndStage(
  options: DownloadAndStageOptions
): Promise<DownloadAndStageResult> {
  const { entry, onProgress, signal } = options;
  const fetcher = options.fetcher ?? httpsFetcher;
  const inactivityMs = options.bodyInactivityMs ?? DEFAULT_BODY_INACTIVITY_MS;

  const emit = (event: InstallerProgressEvent) => {
    if (onProgress) {
      try {
        onProgress(event);
      } catch {
        /* never let renderer callback failures abort the install */
      }
    }
  };

  const fail = (
    phase: InstallerPhase,
    error: string
  ): DownloadAndStageResult => {
    // Always clean up stage dir on failure. binDir() is left untouched
    // for any failure that happens *before* atomic rename; failures
    // after the rename (verify-exec) are handled inline below — we
    // remove the broken binary so the resolver can't see it.
    rmSilent(stageFileFor(entry));
    rmSilent(extractDirFor(entry));
    emit({ tool: entry.tool, phase: "failed", error });
    return { ok: false, phase, error };
  };

  // 0. Pre-clean STAGE state only — never touch the existing install.
  // The user's currently-working `<tool>` (and `<tool>-runtime` for
  // preserve-tree) stays untouched until the new install fully passes
  // verifyExec and we atomically swap below. A network or checksum
  // failure mid-reinstall leaves the user's working binary intact.
  ensureDir(downloadStageDir());
  ensureDir(binDir());
  rmSilent(stageFileFor(entry));
  rmSilent(extractDirFor(entry));
  rmSilent(stagedInstallFor(entry));

  // 1. Download
  emit({ tool: entry.tool, phase: "download", bytesDone: 0 });
  let downloadResult: { sha256: string; bytes: number };
  try {
    const { stream, contentLength } = await fetcher(entry.url, signal);
    downloadResult = await streamToFileWithHash(
      stream,
      stageFileFor(entry),
      contentLength,
      (bytesDone, bytesTotal) => {
        emit({
          tool: entry.tool,
          phase: "download",
          bytesDone,
          bytesTotal: bytesTotal ?? undefined,
        });
      },
      signal,
      inactivityMs
    );
  } catch (err) {
    return fail("download", err instanceof Error ? err.message : String(err));
  }

  // 2. Verify checksum
  emit({ tool: entry.tool, phase: "verify-checksum" });
  if (downloadResult.sha256.toLowerCase() !== entry.sha256.toLowerCase()) {
    return fail(
      "verify-checksum",
      `SHA-256 mismatch: expected ${entry.sha256}, got ${downloadResult.sha256}`
    );
  }

  // 3. Extract (archive) or skip (raw)
  if (entry.archiveType !== "raw") {
    emit({ tool: entry.tool, phase: "extract" });
    try {
      await extractArchive(entry);
    } catch (err) {
      return fail("extract", err instanceof Error ? err.message : String(err));
    }
  }

  const extractedPath = resolveExtractedBinary(entry);
  if (!fs.existsSync(extractedPath)) {
    return fail(
      "extract",
      `binary not found at ${entry.binaryPathInArchive} inside ${entry.tool} archive`
    );
  }

  // 4. Verify code signature (when manifest demands it)
  if (entry.signatureCheck === "codesign-verify") {
    emit({ tool: entry.tool, phase: "verify-signature" });
    try {
      await verifySignature(extractedPath);
    } catch (err) {
      return fail(
        "verify-signature",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  // 5. STAGE the new install at a side-by-side path — DON'T touch the
  // existing install yet.
  //   single-binary: rename the verified extracted binary to <tool>.next
  //   preserve-tree: rename the whole extraction tree to <tool>-runtime-next
  // Either way the existing `<tool>` (and `<tool>-runtime`) keeps working
  // for any concurrent process or for retry-after-failure.
  const stagedInstall = stagedInstallFor(entry);
  try {
    if (entry.installLayout === "single-binary") {
      fs.chmodSync(extractedPath, 0o755);
      fs.renameSync(extractedPath, stagedInstall);
    } else {
      fs.renameSync(extractDirFor(entry), stagedInstall);
      // Tar/unzip usually preserves perms but re-assert defensively.
      fs.chmodSync(
        path.join(stagedInstall, entry.binaryPathInArchive),
        0o755
      );
    }
  } catch (err) {
    rmSilent(stagedInstall);
    return fail(
      "extract",
      `staging failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // 6. verifyExec against the STAGED binary. Catches arch mismatch,
  // segfault-on-launch, etc. before we touch the existing install.
  emit({ tool: entry.tool, phase: "verify-exec" });
  const stagedBin =
    entry.installLayout === "single-binary"
      ? stagedInstall
      : path.join(stagedInstall, entry.binaryPathInArchive);
  const verifyResult = await runVerifyExec(stagedBin, entry.verifyExec);
  if (!verifyResult.ok) {
    // New install is broken — clean it up. The existing install is
    // untouched; the user's `<tool>` keeps working.
    rmSilent(stagedInstall);
    // Surface the captured stderr/stdout (last ~1 KB) along with the
    // verify-exec failure summary. Without this the user just sees
    // "expected exit 0, got 2" with no idea what the binary itself said
    // — the actual diagnostic ("dyld: Library not loaded…", "missing
    // HOME", etc.) lives in verifyResult.output and would be silently
    // dropped otherwise.
    const tail = verifyResult.output.slice(-1024).trim();
    const detail = tail ? `${verifyResult.error}\n${tail}` : verifyResult.error;
    return fail("verify-exec", detail);
  }

  // 7. ATOMIC SWAP — only now do we touch the user's existing install.
  // Each rename here is POSIX-atomic on the same volume (which is
  // guaranteed because everything lives under userDataDir()).
  const finalPath = path.join(binDir(), entry.tool);
  try {
    if (entry.installLayout === "single-binary") {
      // Single rename overwrites the existing executable atomically.
      fs.renameSync(stagedInstall, finalPath);
    } else {
      // preserve-tree: rename old runtime aside, slot new in, recreate
      // symlink atomically via a temp name. If the swap fails partway,
      // the .prev rescue below restores the previous install.
      const runtime = runtimeDirFor(entry);
      const prevRuntime = runtime + ".prev";
      rmSilent(prevRuntime);
      if (fs.existsSync(runtime)) {
        fs.renameSync(runtime, prevRuntime);
      }
      try {
        fs.renameSync(stagedInstall, runtime);
        // Symlink-via-temp-rename: avoids any window where `<tool>` is
        // missing or pointing at the wrong path.
        const symlinkTemp = finalPath + ".next-link";
        rmSilent(symlinkTemp);
        const relTarget = path.join(
          `${entry.tool}-runtime`,
          entry.binaryPathInArchive
        );
        fs.symlinkSync(relTarget, symlinkTemp);
        fs.renameSync(symlinkTemp, finalPath);
      } catch (swapErr) {
        // Swap blew up midway — restore the previous runtime if we
        // moved it aside, so the user is at worst back to square one.
        try {
          if (fs.existsSync(prevRuntime) && !fs.existsSync(runtime)) {
            fs.renameSync(prevRuntime, runtime);
          }
        } catch {
          // Nothing more we can safely do.
        }
        throw swapErr;
      }
      // Success — drop the previous runtime now that the new one is live,
      // unless the caller asked us to keep it for a multi-step transaction.
      if (!options.keepPrev) {
        rmSilent(prevRuntime);
      }
    }
  } catch (err) {
    // Final-stage swap failure leaves the existing install in place
    // (per the .prev rescue above for preserve-tree). For single-binary,
    // a rename failure is rare enough that we just surface it.
    rmSilent(stagedInstall);
    return fail(
      "extract",
      `atomic swap failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // 8. Strip macOS quarantine xattr from the live install. On preserve-tree
  // we cover the whole runtime dir (the binary plus every sibling .dylib);
  // on single-binary we cover just the final binary path.
  if (entry.installLayout === "preserve-tree") {
    await stripQuarantineXattr(runtimeDirFor(entry));
  } else {
    await stripQuarantineXattr(finalPath);
  }

  // 9. Cleanup of stage state — resolver only ever sees binDir().
  rmSilent(stageFileFor(entry));
  rmSilent(extractDirFor(entry));

  emit({ tool: entry.tool, phase: "complete" });
  return { ok: true, finalPath };
}

/**
 * Production wrappers around the electron-free recovery helpers in
 * `recovery.ts`. The wrappers resolve `binDir()` (which transitively
 * imports `electron`) and forward; the pure helpers are testable
 * under plain Node.
 */
import {
  commitKeptPrevAt,
  hasOrphanedKeptPrevAt,
  rollbackKeptPrevAt,
} from "./recovery.js";

export {
  commitKeptPrevAt,
  hasOrphanedKeptPrevAt,
  rollbackKeptPrevAt,
} from "./recovery.js";

/**
 * Delete the kept `<tool>-runtime.prev` after a multi-step transaction
 * (e.g. Parakeet chain) succeeded. No-op if `.prev` doesn't exist or
 * the tool is single-binary. Idempotent.
 */
export function commitKeptPrev(entry: ToolManifestEntry): void {
  commitKeptPrevAt(binDir(), entry);
}

/** See `rollbackKeptPrevAt`. */
export function rollbackKeptPrev(entry: ToolManifestEntry): void {
  rollbackKeptPrevAt(binDir(), entry);
}
