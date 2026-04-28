import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Pure (electron-free) variants of the kept-prev helpers. The
// production wrappers in download.ts call binDir() (which imports
// `electron`); these `*At(binDirPath, entry)` versions take the path
// explicitly so they can run under plain Node.
import {
  commitKeptPrevAt,
  hasOrphanedKeptPrevAt,
  rollbackKeptPrevAt,
} from "../dist/main/installers/recovery.js";

// Minimal stub of a manifest entry that matches the shape rollback /
// commit operate on. Only the four fields below are read.
function pythonLikeEntry() {
  return {
    tool: "python",
    binaryPathInArchive: "python/bin/python3",
    installLayout: "preserve-tree",
  };
}

function mkBinDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gistlist-rollback-test-"));
}

function makeRuntime(binDirPath, name, content = "marker") {
  const dir = path.join(binDirPath, name);
  fs.mkdirSync(path.join(dir, "python", "bin"), { recursive: true });
  fs.writeFileSync(path.join(dir, "python", "bin", "python3"), content);
  return dir;
}

// ---- hasOrphanedKeptPrevAt ----

test("hasOrphanedKeptPrevAt: returns false when .prev does not exist", () => {
  const binDirPath = mkBinDir();
  try {
    assert.equal(hasOrphanedKeptPrevAt(binDirPath, pythonLikeEntry()), false);
  } finally {
    fs.rmSync(binDirPath, { recursive: true, force: true });
  }
});

test("hasOrphanedKeptPrevAt: returns true when python-runtime.prev exists", () => {
  const binDirPath = mkBinDir();
  try {
    makeRuntime(binDirPath, "python-runtime.prev");
    assert.equal(hasOrphanedKeptPrevAt(binDirPath, pythonLikeEntry()), true);
  } finally {
    fs.rmSync(binDirPath, { recursive: true, force: true });
  }
});

test("hasOrphanedKeptPrevAt: returns false for non-preserve-tree layouts", () => {
  const binDirPath = mkBinDir();
  try {
    makeRuntime(binDirPath, "ffmpeg-runtime.prev");
    const ffmpegLikeEntry = { ...pythonLikeEntry(), tool: "ffmpeg", installLayout: "single-binary" };
    assert.equal(hasOrphanedKeptPrevAt(binDirPath, ffmpegLikeEntry), false);
  } finally {
    fs.rmSync(binDirPath, { recursive: true, force: true });
  }
});

// ---- commitKeptPrevAt ----

test("commitKeptPrevAt: removes python-runtime.prev when present", () => {
  const binDirPath = mkBinDir();
  try {
    makeRuntime(binDirPath, "python-runtime.prev");
    commitKeptPrevAt(binDirPath, pythonLikeEntry());
    assert.equal(
      fs.existsSync(path.join(binDirPath, "python-runtime.prev")),
      false,
      ".prev should be deleted on commit"
    );
  } finally {
    fs.rmSync(binDirPath, { recursive: true, force: true });
  }
});

test("commitKeptPrevAt: idempotent when .prev does not exist", () => {
  const binDirPath = mkBinDir();
  try {
    // Should not throw.
    commitKeptPrevAt(binDirPath, pythonLikeEntry());
  } finally {
    fs.rmSync(binDirPath, { recursive: true, force: true });
  }
});

// ---- rollbackKeptPrevAt: the round-3 reviewer edge case ----
//
// When the app is killed mid-swap inside downloadAndStage AFTER renaming
// the old runtime to `.prev` but BEFORE the new staged install lands at
// the canonical position, the next run sees:
//
//   - `<binDir>/python-runtime.prev`  exists (the user's only good runtime)
//   - `<binDir>/python-runtime`        is missing
//
// Without recovery, the next install attempt's swap calls `rmSilent(prevRuntime)`
// before staging the new one — destroying the only known-good runtime.
// rollbackKeptPrev MUST restore `.prev` to the canonical position even when
// canonical is missing.

test("rollbackKeptPrevAt: mid-swap crash recovery — canonical missing, .prev present", () => {
  const binDirPath = mkBinDir();
  try {
    makeRuntime(binDirPath, "python-runtime.prev", "good-runtime-content");
    // No canonical python-runtime — simulating a mid-swap crash.
    assert.equal(
      fs.existsSync(path.join(binDirPath, "python-runtime")),
      false,
      "precondition: canonical runtime should be missing"
    );

    rollbackKeptPrevAt(binDirPath, pythonLikeEntry());

    // .prev should be gone (renamed back to canonical).
    assert.equal(
      fs.existsSync(path.join(binDirPath, "python-runtime.prev")),
      false,
      ".prev should be consumed by rollback"
    );
    // Canonical should now contain what .prev had.
    const restoredContent = fs.readFileSync(
      path.join(binDirPath, "python-runtime", "python", "bin", "python3"),
      "utf-8"
    );
    assert.equal(
      restoredContent,
      "good-runtime-content",
      "canonical should hold the .prev contents after rollback"
    );
    // The canonical symlink at <binDir>/python should point at the
    // restored runtime.
    const linkTarget = fs.readlinkSync(path.join(binDirPath, "python"));
    assert.equal(
      linkTarget,
      path.join("python-runtime", "python", "bin", "python3"),
      "canonical symlink should point at restored runtime"
    );
  } finally {
    fs.rmSync(binDirPath, { recursive: true, force: true });
  }
});

test("rollbackKeptPrevAt: standard rollback — both .prev and (broken) canonical present", () => {
  const binDirPath = mkBinDir();
  try {
    makeRuntime(binDirPath, "python-runtime.prev", "good-runtime-content");
    makeRuntime(binDirPath, "python-runtime", "broken-new-install");

    rollbackKeptPrevAt(binDirPath, pythonLikeEntry());

    // .prev consumed.
    assert.equal(
      fs.existsSync(path.join(binDirPath, "python-runtime.prev")),
      false
    );
    // Canonical now holds .prev's content (the broken new was discarded).
    assert.equal(
      fs.readFileSync(
        path.join(binDirPath, "python-runtime", "python", "bin", "python3"),
        "utf-8"
      ),
      "good-runtime-content"
    );
    // Broken-aside scratch dir should be cleaned up.
    assert.equal(
      fs.existsSync(path.join(binDirPath, "python-runtime.broken")),
      false,
      "broken-aside scratch directory should be cleaned up"
    );
  } finally {
    fs.rmSync(binDirPath, { recursive: true, force: true });
  }
});

test("rollbackKeptPrevAt: no .prev — discards canonical (first-install failure path)", () => {
  const binDirPath = mkBinDir();
  try {
    makeRuntime(binDirPath, "python-runtime", "broken-new-install");

    rollbackKeptPrevAt(binDirPath, pythonLikeEntry());

    // Canonical removed, no .prev to restore.
    assert.equal(
      fs.existsSync(path.join(binDirPath, "python-runtime")),
      false,
      "canonical should be discarded when no .prev exists to fall back on"
    );
  } finally {
    fs.rmSync(binDirPath, { recursive: true, force: true });
  }
});

test("rollbackKeptPrevAt: no-op for single-binary layout", () => {
  const binDirPath = mkBinDir();
  try {
    makeRuntime(binDirPath, "python-runtime.prev");
    const ffmpegLike = { ...pythonLikeEntry(), tool: "ffmpeg", installLayout: "single-binary" };
    rollbackKeptPrevAt(binDirPath, ffmpegLike);
    // .prev should still exist — function is a no-op for single-binary.
    assert.equal(
      fs.existsSync(path.join(binDirPath, "python-runtime.prev")),
      true
    );
  } finally {
    fs.rmSync(binDirPath, { recursive: true, force: true });
  }
});
