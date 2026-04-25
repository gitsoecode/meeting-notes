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

/** Stream a source into a write target while updating a hasher. */
async function streamToFileWithHash(
  source: NodeJS.ReadableStream,
  destPath: string,
  contentLength: number | null,
  onProgress: ((bytesDone: number, bytesTotal: number | null) => void) | null,
  signal: AbortSignal | undefined
): Promise<{ sha256: string; bytes: number }> {
  const hasher = crypto.createHash("sha256");
  const out = fs.createWriteStream(destPath);
  let bytes = 0;

  return await new Promise<{ sha256: string; bytes: number }>((resolve, reject) => {
    const cleanup = () => {
      source.removeAllListeners();
      out.removeAllListeners();
    };
    if (signal) {
      const onAbort = () => {
        source.unpipe(out);
        out.destroy(new Error("aborted"));
        reject(new Error("aborted"));
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    }
    source.on("data", (chunk: Buffer) => {
      hasher.update(chunk);
      bytes += chunk.length;
      if (onProgress) onProgress(bytes, contentLength);
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
 * Top-level installer. Returns ok|failure, never throws.
 * onProgress fires for each phase transition (and during download for byte-level updates).
 */
export async function downloadAndStage(
  options: DownloadAndStageOptions
): Promise<DownloadAndStageResult> {
  const { entry, onProgress, signal } = options;
  const fetcher = options.fetcher ?? httpsFetcher;

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

  // 0. Pre-clean any stale state from a prior (possibly failed) attempt.
  // For preserve-tree tools, also clear any prior runtime dir + symlink so
  // re-installs aren't held back by a corrupt previous attempt.
  ensureDir(downloadStageDir());
  ensureDir(binDir());
  rmSilent(stageFileFor(entry));
  rmSilent(extractDirFor(entry));
  if (entry.installLayout === "preserve-tree") {
    rmSilent(runtimeDirFor(entry));
    // Remove a stale symlink from a prior install. fs.rm with force:true
    // handles symlinks the same as files.
    rmSilent(path.join(binDir(), entry.tool));
  }

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
      signal
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

  // 5. Atomic rename into binDir() — same volume, POSIX-atomic.
  // Two layouts:
  //   single-binary: just move the executable.
  //   preserve-tree: move the whole extraction tree, then symlink the
  //                  canonical <binDir>/<tool> at the bin inside.
  const finalPath = path.join(binDir(), entry.tool);
  try {
    if (entry.installLayout === "single-binary") {
      fs.chmodSync(extractedPath, 0o755);
      rmSilent(finalPath);
      fs.renameSync(extractedPath, finalPath);
    } else {
      // preserve-tree: move the entire extraction dir into runtime/.
      const runtime = runtimeDirFor(entry);
      // Re-clear in case some prior cleanup missed it.
      rmSilent(runtime);
      rmSilent(finalPath);
      fs.renameSync(extractDirFor(entry), runtime);
      // Make sure the binary inside the tree is executable. Tar/unzip
      // usually preserves perms but we re-assert for safety.
      const innerBin = path.join(runtime, entry.binaryPathInArchive);
      fs.chmodSync(innerBin, 0o755);
      // Relative symlink so the install tree is location-independent.
      const relTarget = path.join(
        `${entry.tool}-runtime`,
        entry.binaryPathInArchive
      );
      fs.symlinkSync(relTarget, finalPath);
    }
  } catch (err) {
    // Belt-and-suspenders cleanup: if we partially moved a runtime dir
    // before the symlink failed, get rid of it so the next attempt
    // starts from a clean slate.
    rmSilent(runtimeDirFor(entry));
    rmSilent(finalPath);
    return fail(
      "extract",
      `atomic move failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // 6. verifyExec — last chance to catch "downloaded fine, segfaults".
  emit({ tool: entry.tool, phase: "verify-exec" });
  const verifyResult = await runVerifyExec(finalPath, entry.verifyExec);
  if (!verifyResult.ok) {
    // Pull the broken binary back out so the resolver doesn't see it.
    // For preserve-tree, remove the runtime dir too — without the symlink
    // it'd be orphaned, and we'd rather a clean retry than an inconsistent
    // half-state.
    rmSilent(finalPath);
    if (entry.installLayout === "preserve-tree") {
      rmSilent(runtimeDirFor(entry));
    }
    return fail("verify-exec", verifyResult.error);
  }

  // 7. Cleanup of stage state — resolver only ever sees binDir().
  // For preserve-tree, the extract dir was MOVED (not copied) to runtime/,
  // so it no longer exists at this point — rmSilent is a no-op but kept
  // for symmetry / future archive types that might keep stage around.
  rmSilent(stageFileFor(entry));
  rmSilent(extractDirFor(entry));

  emit({ tool: entry.tool, phase: "complete" });
  return { ok: true, finalPath };
}
