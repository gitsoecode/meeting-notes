import test from "node:test";
import assert from "node:assert/strict";
import {
  validateStartRecording,
  validateStartForDraft,
  validatePause,
  validateResume,
  validateContinue,
  resolveStopTarget,
} from "../dist/main/recording-state.js";

// ---- validateStartRecording ----

test("validateStartRecording: allows start when idle", () => {
  assert.doesNotThrow(() =>
    validateStartRecording({ hasActiveSession: false, hasPausedRun: false })
  );
});

test("validateStartRecording: rejects when active", () => {
  assert.throws(
    () => validateStartRecording({ hasActiveSession: true, hasPausedRun: false }),
    /already in progress/
  );
});

test("validateStartRecording: rejects when paused", () => {
  assert.throws(
    () => validateStartRecording({ hasActiveSession: false, hasPausedRun: true }),
    /paused/
  );
});

// ---- validateStartForDraft ----

test("validateStartForDraft: allows draft status", () => {
  assert.doesNotThrow(() =>
    validateStartForDraft({ hasActiveSession: false, hasPausedRun: false }, "draft")
  );
});

test("validateStartForDraft: allows recording status as recovery", () => {
  assert.doesNotThrow(() =>
    validateStartForDraft({ hasActiveSession: false, hasPausedRun: false }, "recording")
  );
});

test("validateStartForDraft: rejects complete status", () => {
  assert.throws(
    () => validateStartForDraft({ hasActiveSession: false, hasPausedRun: false }, "complete"),
    /expected "draft"/
  );
});

test("validateStartForDraft: rejects paused status", () => {
  assert.throws(
    () => validateStartForDraft({ hasActiveSession: false, hasPausedRun: false }, "paused"),
    /expected "draft"/
  );
});

test("validateStartForDraft: rejects when active session exists", () => {
  assert.throws(
    () => validateStartForDraft({ hasActiveSession: true, hasPausedRun: false }, "draft"),
    /already in progress/
  );
});

// ---- validatePause ----

test("validatePause: allows when active", () => {
  assert.doesNotThrow(() =>
    validatePause({ hasActiveSession: true, hasPausedRun: false })
  );
});

test("validatePause: rejects when not active", () => {
  assert.throws(
    () => validatePause({ hasActiveSession: false, hasPausedRun: false }),
    /No active recording to pause/
  );
});

// ---- validateResume ----

test("validateResume: allows when paused", () => {
  assert.doesNotThrow(() =>
    validateResume({ hasActiveSession: false, hasPausedRun: true })
  );
});

test("validateResume: rejects when active", () => {
  assert.throws(
    () => validateResume({ hasActiveSession: true, hasPausedRun: true }),
    /already active/
  );
});

test("validateResume: rejects when not paused", () => {
  assert.throws(
    () => validateResume({ hasActiveSession: false, hasPausedRun: false }),
    /No paused recording/
  );
});

// ---- validateContinue ----

test("validateContinue: allows complete status", () => {
  assert.doesNotThrow(() =>
    validateContinue({ hasActiveSession: false, hasPausedRun: false }, "complete")
  );
});

test("validateContinue: allows paused status", () => {
  assert.doesNotThrow(() =>
    validateContinue({ hasActiveSession: false, hasPausedRun: false }, "paused")
  );
});

test("validateContinue: rejects draft status", () => {
  assert.throws(
    () => validateContinue({ hasActiveSession: false, hasPausedRun: false }, "draft"),
    /Cannot continue/
  );
});

test("validateContinue: rejects when active session exists", () => {
  assert.throws(
    () => validateContinue({ hasActiveSession: true, hasPausedRun: false }, "complete"),
    /already in progress/
  );
});

// ---- resolveStopTarget ----

test("resolveStopTarget: returns active when session exists", () => {
  assert.equal(
    resolveStopTarget({ hasActiveSession: true, hasPausedRun: false }, false),
    "active"
  );
});

test("resolveStopTarget: prefers active over paused", () => {
  assert.equal(
    resolveStopTarget({ hasActiveSession: true, hasPausedRun: true }, false),
    "active"
  );
});

test("resolveStopTarget: returns paused when no active session", () => {
  assert.equal(
    resolveStopTarget({ hasActiveSession: false, hasPausedRun: true }, false),
    "paused"
  );
});

test("resolveStopTarget: returns paused over cli", () => {
  assert.equal(
    resolveStopTarget({ hasActiveSession: false, hasPausedRun: true }, true),
    "paused"
  );
});

test("resolveStopTarget: returns cli when nothing else", () => {
  assert.equal(
    resolveStopTarget({ hasActiveSession: false, hasPausedRun: false }, true),
    "cli"
  );
});

test("resolveStopTarget: returns null when idle", () => {
  assert.equal(
    resolveStopTarget({ hasActiveSession: false, hasPausedRun: false }, false),
    null
  );
});
