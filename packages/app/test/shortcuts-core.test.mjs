import test from "node:test";
import assert from "node:assert/strict";
import { applyToggleShortcut, resolveToggleShortcut } from "../dist/main/shortcuts-core.js";

test("resolveToggleShortcut falls back to the default accelerator", () => {
  assert.equal(resolveToggleShortcut(""), "CommandOrControl+Shift+M");
});

test("applyToggleShortcut restores the previous shortcut when the new one fails", () => {
  const registered = new Set(["CommandOrControl+Shift+M"]);
  const registry = {
    unregister(shortcut) {
      registered.delete(shortcut);
    },
    register(shortcut) {
      if (shortcut === "BrokenShortcut") return false;
      registered.add(shortcut);
      return true;
    },
  };

  const result = applyToggleShortcut(
    registry,
    "CommandOrControl+Shift+M",
    "BrokenShortcut",
    () => {}
  );

  assert.equal(result.ok, false);
  assert.equal(result.activeShortcut, "CommandOrControl+Shift+M");
  assert.equal(registered.has("CommandOrControl+Shift+M"), true);
});
