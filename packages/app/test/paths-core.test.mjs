import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

// paths-core has no Electron dependency — safe to import directly under
// plain Node. The Electron-aware wrappers in paths.ts cannot be unit
// tested this way because importing `electron` outside main throws.
import {
  binDirOf,
  downloadStageDirOf,
  resolveUserDataDir,
  updaterStateDirOf,
} from "../dist/main/paths-core.js";

test("resolveUserDataDir: returns fallback when env override is unset", () => {
  const out = resolveUserDataDir("/tmp/fallback-userdata", {});
  assert.equal(out, "/tmp/fallback-userdata");
});

test("resolveUserDataDir: returns fallback when env override is whitespace-only", () => {
  const out = resolveUserDataDir("/tmp/fallback-userdata", {
    GISTLIST_USER_DATA_DIR: "   ",
  });
  assert.equal(out, "/tmp/fallback-userdata");
});

test("resolveUserDataDir: returns env override when set", () => {
  const out = resolveUserDataDir("/tmp/fallback-userdata", {
    GISTLIST_USER_DATA_DIR: "/tmp/override-userdata",
  });
  assert.equal(out, "/tmp/override-userdata");
});

test("resolveUserDataDir: trims surrounding whitespace from override", () => {
  const out = resolveUserDataDir("/tmp/fallback", {
    GISTLIST_USER_DATA_DIR: "  /tmp/with-padding  ",
  });
  assert.equal(out, "/tmp/with-padding");
});

test("resolveUserDataDir: defaults env arg to process.env when omitted", () => {
  // Belt-and-suspenders: this test just confirms the function is callable
  // with a single argument without throwing. We don't mutate process.env
  // because the test harness shares it with other tests.
  const out = resolveUserDataDir("/tmp/fallback-defaults");
  assert.ok(typeof out === "string");
  assert.ok(out.length > 0);
});

test("binDirOf / downloadStageDirOf / updaterStateDirOf: all sit under the same root", () => {
  const root = "/tmp/userdata-root";
  const bin = binDirOf(root);
  const stage = downloadStageDirOf(root);
  const updater = updaterStateDirOf(root);

  // Same root invariant — atomic rename across stage→bin only works
  // when both share a volume, which is guaranteed by sharing a parent.
  assert.equal(path.dirname(bin), root);
  assert.equal(path.dirname(stage), root);
  assert.equal(path.dirname(updater), root);

  // Specific subdirs the rest of the codebase will reference by name.
  assert.equal(bin, path.join(root, "bin"));
  assert.equal(stage, path.join(root, "downloads"));
  assert.equal(updater, path.join(root, "updater"));
});
