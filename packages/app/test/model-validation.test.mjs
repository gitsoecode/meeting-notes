import test from "node:test";
import assert from "node:assert/strict";
import {
  getRunStartedSortValue,
  isPromptModelSelectionSupported,
} from "../dist/main/model-validation.js";

test("getRunStartedSortValue prefers valid started timestamps and falls back to date", () => {
  const iso = "2026-04-08T12:30:00.000Z";
  const date = "2026-04-08";

  assert.equal(getRunStartedSortValue(iso, date), Date.parse(iso));
  assert.equal(getRunStartedSortValue(123, date), Date.parse(date));
  assert.equal(getRunStartedSortValue(undefined, "not-a-date"), 0);
});

test("isPromptModelSelectionSupported accepts default, known Claude, and installed Ollama models", () => {
  assert.deepEqual(isPromptModelSelectionSupported(null, []), {
    ok: true,
    model: null,
  });
  assert.deepEqual(isPromptModelSelectionSupported("claude-sonnet-4-6", []), {
    ok: true,
    model: "claude-sonnet-4-6",
  });
  assert.deepEqual(isPromptModelSelectionSupported("qwen3.5:9b", ["qwen3.5:9b"]), {
    ok: true,
    model: "qwen3.5:9b",
  });
  assert.deepEqual(isPromptModelSelectionSupported("qwen3.5:9b", ["qwen3.5:9b:latest"]), {
    ok: true,
    model: "qwen3.5:9b:latest",
  });
  assert.deepEqual(isPromptModelSelectionSupported("qwen3.5:9b", ["qwen3.5:latest"]), {
    ok: true,
    model: "qwen3.5:latest",
  });
  assert.deepEqual(isPromptModelSelectionSupported("gemma3:4b", ["gemma3:4b"]), {
    ok: true,
    model: "gemma3:4b",
  });
  assert.deepEqual(isPromptModelSelectionSupported("gemma3:4b:latest", ["gemma3:4b"]), {
    ok: true,
    model: "gemma3:4b",
  });
});

test("isPromptModelSelectionSupported rejects unsupported Claude and uninstalled local models", () => {
  const unknownClaude = isPromptModelSelectionSupported("claude-made-up", []);
  assert.equal(unknownClaude.ok, false);
  assert.match(unknownClaude.error, /not supported/);

  const uninstalled = isPromptModelSelectionSupported("qwen3.5:9b", []);
  assert.equal(uninstalled.ok, false);
  assert.match(uninstalled.error, /not installed yet/);

  const uninstalledNonCurated = isPromptModelSelectionSupported("made-up-model", []);
  assert.equal(uninstalledNonCurated.ok, false);
  assert.match(uninstalledNonCurated.error, /not installed yet/);
});
