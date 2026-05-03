import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { streamToFileWithHash } from "../dist/main/installers/stream-to-file.js";

// Regression tests for the fresh-VM `ERR_STREAM_DESTROYED` JavaScript
// error dialog from v0.1.8. The bug was a race between abort/inactivity
// teardown and pending fs writes — the hand-rolled pipe would call
// `out.write(chunk)` after `out.destroy()`. The v0.1.9 fix uses
// `node:stream/promises.pipeline()`, which owns teardown for every
// stage. These tests pin the contract:
//
//   - happy path: bytes hashed, file written, count + sha256 returned
//   - external abort: rejects with the abort reason, never throws
//     ERR_STREAM_DESTROYED, and the dest file's writer is closed
//   - inactivity: rejects with the "stalled: …" reason verbatim
//   - hashes match a known input
//
// All tests use `Readable.from(...)` or a manually-fed Readable, so
// they don't need real network or fs sources beyond a tmp file path.

function tempPath() {
  return path.join(
    os.tmpdir(),
    `stream-to-file-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`
  );
}

function expectedSha(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

test("streamToFileWithHash: hashes + counts a small buffer correctly", async () => {
  const dest = tempPath();
  try {
    const payload = Buffer.from("hello world\n", "utf-8");
    const result = await streamToFileWithHash(
      Readable.from([payload]),
      dest,
      payload.length,
      null,
      undefined,
      30_000
    );
    assert.equal(result.bytes, payload.length);
    assert.equal(result.sha256, expectedSha(payload));
    const written = fs.readFileSync(dest);
    assert.deepEqual(written, payload);
  } finally {
    fs.rmSync(dest, { force: true });
  }
});

test("streamToFileWithHash: chunked source produces correct hash", async () => {
  const dest = tempPath();
  try {
    const chunks = [
      Buffer.from("aaaaaa"),
      Buffer.from("bbbbbbb"),
      Buffer.from("ccccccccc"),
    ];
    const full = Buffer.concat(chunks);
    const calls = [];
    const result = await streamToFileWithHash(
      Readable.from(chunks),
      dest,
      full.length,
      (done, total) => calls.push({ done, total }),
      undefined,
      30_000
    );
    assert.equal(result.bytes, full.length);
    assert.equal(result.sha256, expectedSha(full));
    // onProgress called once per chunk.
    assert.equal(calls.length, chunks.length);
    assert.equal(calls[calls.length - 1].done, full.length);
  } finally {
    fs.rmSync(dest, { force: true });
  }
});

test("streamToFileWithHash: external abort rejects without throwing ERR_STREAM_DESTROYED", async () => {
  // The v0.1.8 regression: abort fires while a chunk is still being
  // written, and the hand-rolled pipe would surface a separate
  // ERR_STREAM_DESTROYED uncaught exception alongside the rejected
  // promise. With `pipeline()`, the rejection is the abort reason and
  // no other error escapes. We assert both.
  const dest = tempPath();
  const controller = new AbortController();
  // Build a slow source that never finishes.
  const source = new Readable({
    read() {
      // Push one chunk, then schedule abort, then push more — the
      // abort lands while there are pending writes to the file.
      this.push(Buffer.alloc(32 * 1024, 0xaa));
      setTimeout(() => {
        controller.abort(new Error("user-cancelled"));
        // After the abort, push another chunk to simulate the source
        // continuing to emit after the consumer is gone.
        this.push(Buffer.alloc(32 * 1024, 0xbb));
        this.push(null);
      }, 20);
    },
  });

  let unhandledError = null;
  const onUnhandled = (err) => {
    unhandledError = err;
  };
  process.once("uncaughtException", onUnhandled);
  process.once("unhandledRejection", onUnhandled);
  try {
    await assert.rejects(
      streamToFileWithHash(source, dest, null, null, controller.signal, 30_000),
      (err) => {
        assert.ok(err instanceof Error, "expected an Error");
        // Either the abort reason itself or pipeline's AbortError —
        // what matters is it's NOT ERR_STREAM_DESTROYED.
        assert.equal(
          /ERR_STREAM_DESTROYED/.test(String(err)),
          false,
          "must not surface ERR_STREAM_DESTROYED"
        );
        return true;
      }
    );
    // Give any deferred uncaughtException a chance to fire.
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(
      unhandledError,
      null,
      `no uncaught error should escape, got: ${unhandledError}`
    );
  } finally {
    process.removeListener("uncaughtException", onUnhandled);
    process.removeListener("unhandledRejection", onUnhandled);
    fs.rmSync(dest, { force: true });
  }
});

test("streamToFileWithHash: inactivity watchdog rejects with the 'stalled' reason verbatim", async () => {
  // Build a source that emits one chunk then never sends more. The
  // inactivity timer should trip after ~30ms and the rejection's
  // message should be the watchdog's exact "stalled: …" string —
  // pipeline()'s default behavior would surface a generic AbortError,
  // so the helper has explicit code that rethrows the watchdog reason.
  const dest = tempPath();
  const source = new Readable({
    read() {
      if (this._emitted) return;
      this._emitted = true;
      this.push(Buffer.alloc(64));
      // Don't push more, don't push null. Source goes silent.
    },
    // Explicit _destroy lets pipeline tear down promptly after the
    // watchdog aborts — without it, the test hangs ~10s on Node's
    // default stream-cleanup path.
    destroy(err, cb) {
      cb(err);
    },
  });
  await assert.rejects(
    streamToFileWithHash(source, dest, null, null, undefined, 30),
    (err) => {
      assert.match(
        String(err.message),
        /stalled: no data received for 30ms/,
        "expected verbatim stalled-watchdog message"
      );
      return true;
    }
  );
  fs.rmSync(dest, { force: true });
});

test("streamToFileWithHash: source error rejects cleanly", async () => {
  const dest = tempPath();
  const source = new Readable({
    read() {
      this.destroy(new Error("network reset"));
    },
  });
  await assert.rejects(
    streamToFileWithHash(source, dest, null, null, undefined, 30_000),
    /network reset/
  );
  fs.rmSync(dest, { force: true });
});
