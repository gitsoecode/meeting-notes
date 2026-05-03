/**
 * Pure (electron-free) implementation of the install-pipeline's
 * "download bytes → file → SHA-256" stage. Split out from `download.ts`
 * so the unit-test suite in `packages/app/test/*.test.mjs` can exercise
 * the abort + inactivity-watchdog paths directly without dragging in
 * `bundled.ts` → `paths.ts` → `electron`.
 *
 * Background (v0.1.9 fix for the fresh-VM `ERR_STREAM_DESTROYED`
 * dialog): the previous hand-rolled `source.pipe(out)` + `out.destroy()`
 * raced against Node's fs.WriteStream internals. When abort or
 * inactivity-timeout fired, the source could still have buffered data
 * that the pipe had already scheduled as `out.write(chunk)`. The fs
 * write-completion callback (`node:fs:809` →
 * `node:internal/fs/streams:432`) would then drive the next write on
 * a destroyed stream and bubble out as an unhandled main-process
 * Uncaught Exception dialog. Using `node:stream/promises.pipeline()`
 * gives us correct teardown ordering for every stage of the pipeline
 * and integrates with AbortSignal — the standard library has spent
 * years getting this right; we shouldn't reinvent it.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface StreamToFileResult {
  sha256: string;
  bytes: number;
}

export async function streamToFileWithHash(
  source: NodeJS.ReadableStream,
  destPath: string,
  contentLength: number | null,
  onProgress: ((bytesDone: number, bytesTotal: number | null) => void) | null,
  signal: AbortSignal | undefined,
  inactivityMs: number
): Promise<StreamToFileResult> {
  const hasher = crypto.createHash("sha256");
  let bytes = 0;

  // Inactivity watchdog: if no chunk arrives for `inactivityMs`, abort
  // the pipeline. Re-armed on every chunk by the Transform below.
  const inactivityController = new AbortController();
  let inactivityTimer: NodeJS.Timeout | null = null;
  const armInactivity = () => {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      inactivityController.abort(
        new Error(`stalled: no data received for ${inactivityMs}ms`)
      );
    }, inactivityMs);
  };

  // Single Transform stage that hashes + counts + reports progress + arms
  // the inactivity timer. Sits between source and the file writer so
  // pipeline() owns its lifecycle.
  const tap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hasher.update(chunk);
      bytes += chunk.length;
      if (onProgress) onProgress(bytes, contentLength);
      armInactivity();
      cb(null, chunk);
    },
  });

  const out = fs.createWriteStream(destPath);
  const combinedSignal = signal
    ? AbortSignal.any([signal, inactivityController.signal])
    : inactivityController.signal;

  armInactivity();
  try {
    await pipeline(source, tap, out, { signal: combinedSignal });
    return { sha256: hasher.digest("hex"), bytes };
  } catch (err) {
    // pipeline() destroys all stages on error/abort, so we don't need
    // to call out.destroy() / source.destroy() manually here. The
    // inactivity-watchdog AbortError is rethrown verbatim so the caller
    // sees the "stalled: …" reason rather than "AbortError".
    if (inactivityController.signal.aborted) {
      const reason = inactivityController.signal.reason;
      if (reason instanceof Error) throw reason;
    }
    throw err;
  } finally {
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }
  }
}
