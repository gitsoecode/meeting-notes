import test from "node:test";
import assert from "node:assert/strict";
import { buildInterruptedRunUpdate } from "../dist/main/recording-lifecycle.js";

test("buildInterruptedRunUpdate calculates duration for an interrupted run", () => {
  const update = buildInterruptedRunUpdate(
    "2026-04-08T10:00:00.000Z",
    "2026-04-08T10:15:00.000Z"
  );

  assert.equal(update.ended, "2026-04-08T10:15:00.000Z");
  assert.equal(update.duration_minutes, 15);
});

test("buildInterruptedRunUpdate returns null duration for invalid timestamps", () => {
  const update = buildInterruptedRunUpdate("not-a-time", "2026-04-08T10:15:00.000Z");
  assert.equal(update.duration_minutes, null);
});
