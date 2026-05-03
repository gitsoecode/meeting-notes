import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  expectedMachOArch,
  isHostArchBinary,
} from "../dist/main/installers/arch.js";

test("expectedMachOArch maps process.arch to Mach-O token", () => {
  assert.equal(expectedMachOArch("arm64"), "arm64");
  assert.equal(expectedMachOArch("x64"), "x86_64");
  assert.equal(expectedMachOArch("ia32"), null);
  assert.equal(expectedMachOArch("ppc"), null);
});

test("isHostArchBinary returns true for the running node binary", async () => {
  // process.execPath is whatever node we're running under — by definition
  // host-arch. The test exercises the real /usr/bin/file shellout end-to-end
  // and asserts the parser handles real Mach-O output correctly.
  if (process.platform !== "darwin") {
    return; // /usr/bin/file -bL semantics differ on non-macOS
  }
  const ok = await isHostArchBinary(process.execPath);
  assert.equal(ok, true, `expected ${process.execPath} to match ${process.arch}`);
});

test("isHostArchBinary returns false for a missing path", async () => {
  const fake = path.join(os.tmpdir(), `no-such-binary-${Date.now()}`);
  assert.equal(await isHostArchBinary(fake), false);
});

test("isHostArchBinary returns false for a non-binary file", async () => {
  // Plain text; /usr/bin/file reports something that doesn't start with
  // "Mach-O ..." — must be treated as "not the right arch."
  const tmp = path.join(os.tmpdir(), `not-a-binary-${Date.now()}.txt`);
  fs.writeFileSync(tmp, "hello world\n", "utf-8");
  try {
    assert.equal(await isHostArchBinary(tmp), false);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});
