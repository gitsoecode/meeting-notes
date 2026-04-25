import test from "node:test";
import assert from "node:assert/strict";

import {
  findManifestEntry,
  TOOL_MANIFEST,
} from "../dist/main/installers/manifest.js";

// We test against the live manifest entries because they encode the
// product decisions we care about (Rosetta fallback for ffmpeg, etc.).
// If a future entry is added or removed, these tests pin the resolver
// behavior we expect.

test("findManifestEntry: returns null for unsupported archs", () => {
  // Real-world manifests only cover darwin arm64 / x64. Anything else
  // (linux, windows, mips, ppc) gets a clean null and the wizard shows
  // "Unsupported architecture."
  assert.equal(findManifestEntry("ffmpeg", "ia32"), null);
  assert.equal(findManifestEntry("ffmpeg", "arm"), null);
});

test("findManifestEntry: ffmpeg on arm64 falls back to x64 entry (Rosetta)", () => {
  const entry = findManifestEntry("ffmpeg", "arm64");
  assert.ok(entry, "expected ffmpeg entry for arm64 via Rosetta fallback");
  assert.equal(entry.tool, "ffmpeg");
  assert.equal(entry.arch, "x64");
  assert.match(
    entry.notes ?? "",
    /Rosetta/i,
    "Rosetta-fallback entries should explain the caveat in notes"
  );
});

test("findManifestEntry: ffmpeg on x64 returns x64 entry directly", () => {
  const entry = findManifestEntry("ffmpeg", "x64");
  assert.ok(entry);
  assert.equal(entry.arch, "x64");
});

test("findManifestEntry: ollama is universal — same entry for both archs", () => {
  const arm64Entry = findManifestEntry("ollama", "arm64");
  const x64Entry = findManifestEntry("ollama", "x64");
  assert.ok(arm64Entry);
  assert.ok(x64Entry);
  // Universal entry is shared — no architecture-specific divergence.
  assert.equal(arm64Entry.url, x64Entry.url);
  assert.equal(arm64Entry.arch, "universal");
});

test("findManifestEntry: whisper-cli has no entry for first beta", () => {
  // whisper.cpp v1.8.4 ships no signed macOS binary in Releases.
  // Per the plan, whisper-local is hidden from the wizard until
  // we either build our own or upstream ships one.
  assert.equal(findManifestEntry("whisper-cli", "arm64"), null);
  assert.equal(findManifestEntry("whisper-cli", "x64"), null);
});

test("manifest schema: every entry has a complete trust-anchor set", () => {
  for (const entry of TOOL_MANIFEST) {
    assert.ok(entry.url.startsWith("https://"), `${entry.tool} url must be https`);
    assert.match(
      entry.sha256,
      /^[0-9a-f]{64}$/,
      `${entry.tool} sha256 must be 64 hex chars`
    );
    assert.ok(entry.version.length > 0, `${entry.tool} version must be set`);
    assert.ok(
      entry.minMacOS.length > 0,
      `${entry.tool} minMacOS must be set`
    );
    assert.ok(entry.license.spdx, `${entry.tool} license.spdx required`);
    assert.ok(entry.license.url, `${entry.tool} license.url required`);
    assert.ok(
      ["single-binary", "preserve-tree"].includes(entry.installLayout),
      `${entry.tool} installLayout must be valid`
    );
    assert.ok(
      ["codesign-verify", "none"].includes(entry.signatureCheck),
      `${entry.tool} signatureCheck must be valid`
    );
    assert.ok(
      Array.isArray(entry.verifyExec.args),
      `${entry.tool} verifyExec.args must be array`
    );
    assert.ok(
      entry.verifyExec.timeoutMs > 0,
      `${entry.tool} verifyExec.timeoutMs must be > 0`
    );
  }
});
