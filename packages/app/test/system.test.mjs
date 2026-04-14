import test from "node:test";
import assert from "node:assert/strict";

// system.ts caches the macOS version, so we test the exported functions
// in a way that works regardless of platform.
import { isSystemAudioSupported, getMacOsVersion } from "../dist/main/system.js";

test("getMacOsVersion: returns an object with major/minor/patch on macOS, null otherwise", () => {
  const ver = getMacOsVersion();
  if (process.platform === "darwin") {
    assert.ok(ver !== null, "should return a version object on macOS");
    assert.ok(typeof ver.major === "number", "major should be a number");
    assert.ok(typeof ver.minor === "number", "minor should be a number");
    assert.ok(typeof ver.patch === "number", "patch should be a number");
    assert.ok(typeof ver.raw === "string", "raw should be a string");
    assert.ok(ver.major >= 10, "macOS major version should be >= 10");
  } else {
    assert.equal(ver, null, "should return null on non-macOS");
  }
});

test("isSystemAudioSupported: returns boolean consistent with macOS version", () => {
  const supported = isSystemAudioSupported();
  assert.ok(typeof supported === "boolean", "should return a boolean");

  if (process.platform !== "darwin") {
    assert.equal(supported, false, "should be false on non-macOS");
  } else {
    const ver = getMacOsVersion();
    if (ver) {
      const expected = ver.major > 14 || (ver.major === 14 && ver.minor >= 2);
      assert.equal(supported, expected, `macOS ${ver.major}.${ver.minor} should be ${expected}`);
    }
  }
});
