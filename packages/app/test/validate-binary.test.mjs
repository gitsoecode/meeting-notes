import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  parseVersion,
  validateResolvedBinary,
} from "../dist/main/installers/validate-binary.js";

// `validateResolvedBinary` is the central protection against poisoning
// the engine with a wrong-arch app-managed binary on first record. App
// startup, the smoke-audio bootstrap, and the `deps:check` IPC handler
// all flow through it via `resolveAndValidate`. These tests pin its
// branch behavior so a future refactor can't quietly weaken the rule.
//
// Authored against the pure (electron-free) module so node:test can
// import it directly. The convenience wrapper in `validated-resolve.ts`
// only adds a `resolveBin` lookup — its behavior is exercised through
// the deps:check Playwright spec.

const MOCK_FFMPEG_ENTRY = {
  tool: "ffmpeg",
  verifyExec: { args: ["-version"], expectExit: 0, timeoutMs: 5000 },
};

const MOCK_FAILING_ENTRY = {
  tool: "ffmpeg",
  // Force verifyExec to fail by demanding an exit code the binary won't produce.
  verifyExec: { args: ["-version"], expectExit: 99, timeoutMs: 5000 },
};

test("system source returns system-unverified without touching disk or spawning", async () => {
  // The injected source `system` must short-circuit before any
  // filesystem access (no `file -bL`) AND before any spawn. We pass a
  // path that doesn't exist anywhere so:
  //   - if a regression made `isHostArchBinary` run for system sources,
  //     `/usr/bin/file -bL` would return non-zero and cascade into the
  //     non-injectable branch (assertion below would fail);
  //   - if a regression made `runVerifyExec` run, spawn would error
  //     immediately because the file doesn't exist (assertion would
  //     also fail).
  // Critically, this test never names `/usr/bin/python3` or any other
  // CLT stub — a regression here must never have a chance to pop the
  // macOS Command Line Tools install dialog.
  const fakePath = path.join(
    os.tmpdir(),
    `nonexistent-system-bin-${Date.now()}-${Math.random()}`
  );
  const result = await validateResolvedBinary(
    "ffmpeg",
    { path: fakePath, source: "system" },
    MOCK_FFMPEG_ENTRY
  );
  assert.equal(result.verified, "system-unverified");
  assert.equal(result.injectable, true);
  assert.equal(result.version, null);
  assert.equal(result.path, fakePath);
});

test("app-managed arch mismatch returns injectable:false", async () => {
  // Stage a non-Mach-O file on disk. /usr/bin/file -bL will report
  // something like "ASCII text" — `isHostArchBinary` returns false and
  // we never reach verifyExec. This is the test for the regression that
  // motivated the whole helper: a wrong-arch ffmpeg leftover from a
  // prior install must NOT slip past arch validation.
  const tmp = path.join(os.tmpdir(), `not-macho-${Date.now()}-${Math.random()}.txt`);
  fs.writeFileSync(tmp, "#!/bin/sh\necho 'pretend ffmpeg'\n");
  try {
    const result = await validateResolvedBinary(
      "ffmpeg",
      { path: tmp, source: "app-installed" },
      MOCK_FFMPEG_ENTRY
    );
    assert.equal(result.verified, "system-unverified");
    assert.equal(result.injectable, false);
    assert.equal(result.path, tmp);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

test("app-managed verifyExec failure returns injectable:false", async () => {
  // process.execPath is a real Mach-O binary matching the host arch.
  // We pair it with a manifest entry whose expected exit code is 99
  // so the spawn succeeds but verifyExec.ok is false. This proves the
  // arch check passes (spawn ran) and the verifyExec check independently
  // gates injection.
  const result = await validateResolvedBinary(
    "ffmpeg",
    { path: process.execPath, source: "app-installed" },
    MOCK_FAILING_ENTRY
  );
  assert.equal(result.verified, "system-unverified");
  assert.equal(result.injectable, false);
});

test("app-managed valid binary returns verified + injectable:true", async () => {
  // process.execPath as our "binary," with a verifyExec policy that
  // accepts exit 0. node accepts `--version`/`-v` and exits 0. Use a
  // synthetic entry that runs node `--version` so verifyExec.ok is true.
  const nodeEntry = {
    tool: "ffmpeg",
    verifyExec: { args: ["--version"], expectExit: 0, timeoutMs: 5000 },
  };
  const result = await validateResolvedBinary(
    "ffmpeg",
    { path: process.execPath, source: "app-installed" },
    nodeEntry
  );
  assert.equal(result.verified, "verified");
  assert.equal(result.injectable, true);
  assert.equal(result.path, process.execPath);
  // Version parsing: node prints "vXX.Y.Z" which contains a number with
  // dots, so the generic patterns should pull out something.
  assert.ok(result.version !== null, "expected a version string");
});

test("app-managed binary with no manifest entry trusts arch check", async () => {
  // Edge case: a tool that exists on disk and matches arch but isn't
  // in the manifest. Defensive default: trust arch, mark verified+
  // injectable so the engine can try. This branch is unreachable in
  // production for managed tools (would be a manifest-coverage bug)
  // but the test pins the behavior so a future refactor can't quietly
  // turn it into a false-negative that breaks startup.
  const result = await validateResolvedBinary(
    "ffmpeg",
    { path: process.execPath, source: "app-installed" },
    null
  );
  assert.equal(result.verified, "verified");
  assert.equal(result.injectable, true);
});

test("parseVersion extracts ffmpeg / Python / generic patterns", () => {
  assert.equal(
    parseVersion("ffmpeg", "ffmpeg version 8.1 Copyright (c) 2000-2026"),
    "8.1"
  );
  assert.equal(parseVersion("python", "Python 3.12.13\n"), "3.12.13");
  assert.equal(parseVersion("ollama", "ollama version 0.21.2"), "0.21.2");
  assert.equal(parseVersion("ffmpeg", "no version here"), null);
});
