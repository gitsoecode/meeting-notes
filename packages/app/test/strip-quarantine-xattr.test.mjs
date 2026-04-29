import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { stripQuarantineXattr } from "../dist/main/installers/xattr.js";

// Best-effort xattr strip after install. Three guarantees:
//   1. No-op on non-darwin (skips the spawn entirely).
//   2. On darwin, never throws even if the target doesn't exist or has no
//      quarantine xattr — the whole point is "best effort".
//   3. Awaitable — callers can `await` and continue safely.

test("stripQuarantineXattr: returns successfully on non-darwin", async (t) => {
  if (process.platform === "darwin") {
    t.skip("non-darwin-only assertion");
    return;
  }
  // On linux the function is a no-op; should resolve quickly without
  // spawning anything. Even a clearly-bogus path is fine.
  await stripQuarantineXattr("/no/such/path/exists/here");
  assert.ok(true, "stripQuarantineXattr resolved on non-darwin");
});

test("stripQuarantineXattr: never throws on a missing path", async () => {
  // Both platforms: even when the target doesn't exist, stripping must
  // not throw. xattr -dr exits non-zero in this case on darwin; our
  // wrapper swallows that. On linux, we never spawn.
  await stripQuarantineXattr("/no/such/path/even/maybe");
  assert.ok(true);
});

test("stripQuarantineXattr: never throws on an existing path", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gistlist-xattr-test-"));
  const file = path.join(tmp, "f");
  fs.writeFileSync(file, "x");
  try {
    await stripQuarantineXattr(file);
    await stripQuarantineXattr(tmp);
    assert.ok(true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
