import test from "node:test";
import assert from "node:assert/strict";

import {
  INSTALL_ORDER,
  deriveRequiredInstalls,
  initialState,
  nextPendingId,
  reducer,
  totalRemainingBytes,
} from "../renderer/src/components/wizard/installChain.mjs";

// Helper: build a full DepsCheckResult-shaped object with all paths
// missing. Tests pass overrides via the spread.
function depsAllMissing() {
  return {
    ffmpeg: { path: null },
    ffprobe: { path: null },
    parakeet: { path: null },
    ollama: { daemon: false },
  };
}

// Helper: full plan with all five deps required and missing. Used by
// reducer tests so we exercise the full state machine.
function fullPlanAllMissing() {
  return deriveRequiredInstalls({
    deps: depsAllMissing(),
    asrProvider: "parakeet-mlx",
    llmProvider: "ollama",
    enableSemanticSearch: true,
    localLlmModel: "gemma3:4b",
    localLlmInstalled: false,
    embedAlreadyInstalled: false,
    localLlmSizeGb: 5,
  });
}

// ---- deriveRequiredInstalls --------------------------------------------------

test("deriveRequiredInstalls: parakeet + ollama LLM + semantic search → all 5 deps", () => {
  const plan = fullPlanAllMissing();
  assert.deepEqual(
    plan.map((p) => p.id),
    ["ffmpeg", "parakeet", "ollama", "embed-model", "local-llm"]
  );
  assert.equal(plan.every((p) => !p.alreadyReady), true);
});

test("deriveRequiredInstalls: order matches INSTALL_ORDER (no reorder)", () => {
  const plan = fullPlanAllMissing();
  // Filter INSTALL_ORDER to the ids present in the plan, then assert
  // the plan's id sequence matches.
  const expected = INSTALL_ORDER.filter((id) => plan.some((p) => p.id === id));
  assert.deepEqual(
    plan.map((p) => p.id),
    expected
  );
});

test("deriveRequiredInstalls: cloud ASR (openai) drops Parakeet row", () => {
  const plan = deriveRequiredInstalls({
    deps: depsAllMissing(),
    asrProvider: "openai",
    llmProvider: "claude",
    enableSemanticSearch: false,
    localLlmModel: null,
    localLlmInstalled: false,
    embedAlreadyInstalled: false,
  });
  assert.deepEqual(
    plan.map((p) => p.id),
    ["ffmpeg"]
  );
});

test("deriveRequiredInstalls: cloud LLM + semantic search → ffmpeg + Ollama + embed (no llm model)", () => {
  // The "Claude user with semantic search" path that v0.1.9's review
  // round caught: Ollama is required for the embedding model even when
  // the LLM provider is cloud.
  const plan = deriveRequiredInstalls({
    deps: depsAllMissing(),
    asrProvider: "openai",
    llmProvider: "claude",
    enableSemanticSearch: true,
    localLlmModel: null,
    localLlmInstalled: false,
    embedAlreadyInstalled: false,
  });
  assert.deepEqual(
    plan.map((p) => p.id),
    ["ffmpeg", "ollama", "embed-model"]
  );
});

test("deriveRequiredInstalls: ollama LLM without semantic search → ffmpeg + Ollama + local-llm (no embed)", () => {
  const plan = deriveRequiredInstalls({
    deps: depsAllMissing(),
    asrProvider: "openai",
    llmProvider: "ollama",
    enableSemanticSearch: false,
    localLlmModel: "gemma3:4b",
    localLlmInstalled: false,
    embedAlreadyInstalled: false,
  });
  assert.deepEqual(
    plan.map((p) => p.id),
    ["ffmpeg", "ollama", "local-llm"]
  );
});

test("deriveRequiredInstalls: alreadyReady flag reflects current dep state", () => {
  const plan = deriveRequiredInstalls({
    deps: {
      ffmpeg: { path: "/opt/homebrew/bin/ffmpeg" },
      ffprobe: { path: "/opt/homebrew/bin/ffprobe" },
      parakeet: { path: null },
      ollama: { daemon: true },
    },
    asrProvider: "parakeet-mlx",
    llmProvider: "ollama",
    enableSemanticSearch: true,
    localLlmModel: "gemma3:4b",
    localLlmInstalled: true,
    embedAlreadyInstalled: false,
    localLlmSizeGb: 5,
  });
  const byId = Object.fromEntries(plan.map((p) => [p.id, p.alreadyReady]));
  assert.deepEqual(byId, {
    ffmpeg: true,           // both ffmpeg + ffprobe present
    parakeet: false,        // missing
    ollama: true,           // daemon up
    "embed-model": false,   // missing
    "local-llm": true,      // already pulled
  });
});

test("deriveRequiredInstalls: ffmpeg requires both ffmpeg AND ffprobe to be ready", () => {
  // Half-installed state ("ffmpeg present · ffprobe missing") must NOT
  // mark the row as alreadyReady. Engine code requires both.
  const plan = deriveRequiredInstalls({
    deps: {
      ffmpeg: { path: "/opt/homebrew/bin/ffmpeg" },
      ffprobe: { path: null },
      parakeet: { path: null },
      ollama: { daemon: false },
    },
    asrProvider: "openai",
    llmProvider: "claude",
    enableSemanticSearch: false,
    localLlmModel: null,
    localLlmInstalled: false,
    embedAlreadyInstalled: false,
  });
  assert.equal(plan[0].id, "ffmpeg");
  assert.equal(plan[0].alreadyReady, false);
});

test("deriveRequiredInstalls: app-managed binary with system-unverified arch is treated as not-ready", () => {
  // Repair case: ffmpeg was installed by the app but failed arch
  // validation (e.g. wrong-arch after migrating from Intel). The path
  // is set, but the row should run again to fix it.
  const plan = deriveRequiredInstalls({
    deps: {
      ffmpeg: {
        path: "/Users/x/.gistlist/bin/ffmpeg",
        source: "app-installed",
        verified: "system-unverified",
      },
      ffprobe: {
        path: "/Users/x/.gistlist/bin/ffprobe",
        source: "app-installed",
        verified: "system-unverified",
      },
      parakeet: { path: null },
      ollama: { daemon: false },
    },
    asrProvider: "openai",
    llmProvider: "claude",
    enableSemanticSearch: false,
    localLlmModel: null,
    localLlmInstalled: false,
    embedAlreadyInstalled: false,
  });
  assert.equal(plan[0].id, "ffmpeg");
  assert.equal(plan[0].alreadyReady, false);
});

test("deriveRequiredInstalls: parakeet ready requires valid Python runtime", () => {
  // The venv-against-broken-Python case — Parakeet binary is on disk
  // but the Python it was built against failed verification. Forcing
  // re-install rebuilds the venv against fresh Python.
  const plan = deriveRequiredInstalls({
    deps: {
      ffmpeg: { path: "/opt/ffmpeg" },
      ffprobe: { path: "/opt/ffprobe" },
      parakeet: { path: "/Users/x/.gistlist/parakeet-venv/bin/mlx_audio.stt.generate" },
      python: {
        path: "/Users/x/.gistlist/bin/python",
        source: "app-installed",
        verified: "system-unverified",
      },
      ollama: { daemon: false },
    },
    asrProvider: "parakeet-mlx",
    llmProvider: "claude",
    enableSemanticSearch: false,
    localLlmModel: null,
    localLlmInstalled: false,
    embedAlreadyInstalled: false,
  });
  const parakeetRow = plan.find((p) => p.id === "parakeet");
  assert.ok(parakeetRow);
  assert.equal(parakeetRow.alreadyReady, false);
});

test("deriveRequiredInstalls: ollama llmProvider without selected model omits local-llm row", () => {
  // Edge case: user just landed on the Providers step and the auto-select
  // hasn't picked a model yet. We don't render a "Model: " row with no
  // model name.
  const plan = deriveRequiredInstalls({
    deps: depsAllMissing(),
    asrProvider: "openai",
    llmProvider: "ollama",
    enableSemanticSearch: false,
    localLlmModel: null,
    localLlmInstalled: false,
    embedAlreadyInstalled: false,
  });
  assert.deepEqual(
    plan.map((p) => p.id),
    ["ffmpeg", "ollama"]
  );
});

// ---- totalRemainingBytes ----------------------------------------------------

test("totalRemainingBytes: sums only not-already-ready rows", () => {
  const plan = [
    { id: "ffmpeg", name: "", estimatedBytes: 50_000_000, alreadyReady: true },
    { id: "ollama", name: "", estimatedBytes: 130_000_000, alreadyReady: false },
    { id: "embed-model", name: "", estimatedBytes: 274_000_000, alreadyReady: false },
  ];
  assert.equal(totalRemainingBytes(plan), 130_000_000 + 274_000_000);
});

test("totalRemainingBytes: empty plan → 0", () => {
  assert.equal(totalRemainingBytes([]), 0);
});

// ---- initialState + nextPendingId -------------------------------------------

test("initialState: ready/pending derived from alreadyReady", () => {
  const plan = [
    { id: "ffmpeg", name: "", estimatedBytes: 0, alreadyReady: true },
    { id: "ollama", name: "", estimatedBytes: 0, alreadyReady: false },
  ];
  const state = initialState(plan);
  assert.equal(state.chainState, "idle");
  assert.equal(state.currentId, null);
  assert.equal(state.cancelRequested, false);
  assert.deepEqual(state.rows.ffmpeg, { kind: "ready" });
  assert.deepEqual(state.rows.ollama, { kind: "pending" });
});

test("nextPendingId: skips ready/done, returns first pending in plan order", () => {
  const plan = [
    { id: "ffmpeg", name: "", estimatedBytes: 0, alreadyReady: true },
    { id: "parakeet", name: "", estimatedBytes: 0, alreadyReady: false },
    { id: "ollama", name: "", estimatedBytes: 0, alreadyReady: false },
  ];
  const rows = {
    ffmpeg: { kind: "ready" },
    parakeet: { kind: "done" },
    ollama: { kind: "pending" },
  };
  assert.equal(nextPendingId(plan, rows), "ollama");
});

test("nextPendingId: returns null when no pending", () => {
  const plan = [
    { id: "ffmpeg", name: "", estimatedBytes: 0, alreadyReady: true },
  ];
  assert.equal(nextPendingId(plan, { ffmpeg: { kind: "ready" } }), null);
});

// ---- reducer: start ---------------------------------------------------------

test("reducer start: transitions idle → running, picks first pending row", () => {
  const plan = fullPlanAllMissing();
  const state = reducer(initialState(plan), { type: "start", plan });
  assert.equal(state.chainState, "running");
  assert.equal(state.currentId, "ffmpeg");
  assert.deepEqual(state.rows.ffmpeg, { kind: "running", progress: null });
  assert.deepEqual(state.rows.parakeet, { kind: "pending" });
});

test("reducer start: with all rows ready → done immediately, no currentId", () => {
  const plan = [
    { id: "ffmpeg", name: "", estimatedBytes: 0, alreadyReady: true },
  ];
  const state = reducer(initialState(plan), { type: "start", plan });
  assert.equal(state.chainState, "done");
  assert.equal(state.currentId, null);
});

// ---- reducer: ordered execution ---------------------------------------------

test("reducer succeeded: advances to next pending in order", () => {
  const plan = fullPlanAllMissing();
  let state = initialState(plan);
  state = reducer(state, { type: "start", plan });
  // ffmpeg done → next is parakeet
  state = reducer(state, { type: "succeeded", id: "ffmpeg", plan });
  assert.equal(state.currentId, "parakeet");
  assert.deepEqual(state.rows.ffmpeg, { kind: "done" });
  assert.deepEqual(state.rows.parakeet, { kind: "running", progress: null });
  // parakeet done → next is ollama
  state = reducer(state, { type: "succeeded", id: "parakeet", plan });
  assert.equal(state.currentId, "ollama");
  // ollama done → embed-model
  state = reducer(state, { type: "succeeded", id: "ollama", plan });
  assert.equal(state.currentId, "embed-model");
  // embed-model done → local-llm
  state = reducer(state, { type: "succeeded", id: "embed-model", plan });
  assert.equal(state.currentId, "local-llm");
  // local-llm done → chain done
  state = reducer(state, { type: "succeeded", id: "local-llm", plan });
  assert.equal(state.chainState, "done");
  assert.equal(state.currentId, null);
});

// ---- reducer: progress ------------------------------------------------------

test("reducer progress: forwards snapshot into running row", () => {
  const plan = fullPlanAllMissing();
  let state = reducer(initialState(plan), { type: "start", plan });
  const snap = { bytes: { done: 1024, total: 2048 }, speed: 512, eta: 2 };
  state = reducer(state, { type: "progress", id: "ffmpeg", snapshot: snap });
  assert.deepEqual(state.rows.ffmpeg, { kind: "running", progress: snap });
});

test("reducer progress: ignored when row isn't running", () => {
  const plan = fullPlanAllMissing();
  let state = reducer(initialState(plan), { type: "start", plan });
  // parakeet is `pending` at this point (only ffmpeg is `running`).
  const before = state.rows.parakeet;
  state = reducer(state, {
    type: "progress",
    id: "parakeet",
    snapshot: { percent: 50 },
  });
  assert.deepEqual(state.rows.parakeet, before);
});

test("reducer progress: percent-only snapshot for embed-model", () => {
  const plan = fullPlanAllMissing();
  let state = initialState(plan);
  state = reducer(state, { type: "start", plan });
  state = reducer(state, { type: "succeeded", id: "ffmpeg", plan });
  state = reducer(state, { type: "succeeded", id: "parakeet", plan });
  state = reducer(state, { type: "succeeded", id: "ollama", plan });
  // embed-model is now active; pct-only progress arrives via setup-llm:progress
  state = reducer(state, {
    type: "progress",
    id: "embed-model",
    snapshot: { percent: 42, phase: "Downloading" },
  });
  assert.deepEqual(state.rows["embed-model"], {
    kind: "running",
    progress: { percent: 42, phase: "Downloading" },
  });
});

// ---- reducer: failure → halt → retry ----------------------------------------

test("reducer failed: halts chain at failed row, leaves later rows pending", () => {
  const plan = fullPlanAllMissing();
  let state = reducer(initialState(plan), { type: "start", plan });
  // ffmpeg succeeds, then parakeet fails
  state = reducer(state, { type: "succeeded", id: "ffmpeg", plan });
  state = reducer(state, {
    type: "failed",
    id: "parakeet",
    error: "checksum mismatch",
  });
  assert.equal(state.chainState, "paused");
  assert.equal(state.currentId, null);
  assert.deepEqual(state.rows.parakeet, {
    kind: "failed",
    error: "checksum mismatch",
  });
  // Subsequent rows untouched
  assert.deepEqual(state.rows.ollama, { kind: "pending" });
  assert.deepEqual(state.rows["embed-model"], { kind: "pending" });
});

test("reducer retry: flips failed → pending, resumes chain from that row", () => {
  const plan = fullPlanAllMissing();
  let state = reducer(initialState(plan), { type: "start", plan });
  state = reducer(state, { type: "succeeded", id: "ffmpeg", plan });
  state = reducer(state, {
    type: "failed",
    id: "parakeet",
    error: "boom",
  });
  state = reducer(state, { type: "retry", plan });
  assert.equal(state.chainState, "running");
  assert.equal(state.currentId, "parakeet");
  assert.deepEqual(state.rows.parakeet, { kind: "running", progress: null });
  // ffmpeg stays done; we don't re-run completed rows
  assert.deepEqual(state.rows.ffmpeg, { kind: "done" });
});

// ---- reducer: cancel --------------------------------------------------------

test("reducer cancel-request: sets flag while chain is running, no immediate state change", () => {
  const plan = fullPlanAllMissing();
  let state = reducer(initialState(plan), { type: "start", plan });
  state = reducer(state, { type: "cancel-request", mode: "abort" });
  assert.equal(state.cancelRequested, true);
  assert.equal(state.chainState, "running");
  // Active row is still running — graceful break waits for the dispatcher
  assert.deepEqual(state.rows.ffmpeg, { kind: "running", progress: null });
});

test("reducer cancel-request + succeeded: stops chain after current dep finishes", () => {
  // Cancel during a non-cancellable install (e.g. ffmpeg). Active dep
  // finishes, chain stops, row marked `done` (it really completed).
  const plan = fullPlanAllMissing();
  let state = reducer(initialState(plan), { type: "start", plan });
  state = reducer(state, { type: "cancel-request", mode: "graceful" });
  state = reducer(state, { type: "succeeded", id: "ffmpeg", plan });
  assert.equal(state.chainState, "cancelled");
  assert.equal(state.currentId, null);
  assert.deepEqual(state.rows.ffmpeg, { kind: "done" });
  // Subsequent rows stay pending
  assert.deepEqual(state.rows.parakeet, { kind: "pending" });
  // Cancel flag clears
  assert.equal(state.cancelRequested, false);
  assert.equal(state.cancelMode, null);
});

test("reducer cancel-request graceful + failed: real failure is preserved (NOT marked cancelled)", () => {
  // The fix for the "Cancel hides real failures" bug. User clicks
  // Cancel during ffmpeg's install (non-cancellable, mode="graceful").
  // ffmpeg then fails for an unrelated reason (network timeout). The
  // reducer must keep the row as `failed` with the error, not silently
  // reclassify as `cancelled` — otherwise the user loses the error
  // detail and the Retry path.
  const plan = fullPlanAllMissing();
  let state = reducer(initialState(plan), { type: "start", plan });
  state = reducer(state, { type: "cancel-request", mode: "graceful" });
  state = reducer(state, {
    type: "failed",
    id: "ffmpeg",
    error: "network timeout",
  });
  assert.equal(state.chainState, "paused");
  assert.deepEqual(state.rows.ffmpeg, {
    kind: "failed",
    error: "network timeout",
  });
});

test("reducer cancel-request + failed (Parakeet abort): row marked Cancelled, not Failed", () => {
  // The Parakeet path: user clicks Cancel, caller invokes
  // `api.cancelSetupAsr()`, the install promise rejects with an abort
  // error. The reducer sees `cancelRequested === true && currentId ===
  // failedId` → mark Cancelled, not Failed.
  const plan = fullPlanAllMissing();
  let state = reducer(initialState(plan), { type: "start", plan });
  state = reducer(state, { type: "succeeded", id: "ffmpeg", plan });
  // parakeet now active
  state = reducer(state, { type: "cancel-request", mode: "abort" });
  state = reducer(state, {
    type: "failed",
    id: "parakeet",
    error: "AbortError",
  });
  assert.equal(state.chainState, "cancelled");
  assert.deepEqual(state.rows.parakeet, { kind: "cancelled" });
});

test("reducer retry after cancel: resumes from cancelled row", () => {
  const plan = fullPlanAllMissing();
  let state = reducer(initialState(plan), { type: "start", plan });
  state = reducer(state, { type: "cancel-request", mode: "abort" });
  state = reducer(state, { type: "succeeded", id: "ffmpeg", plan });
  // Chain cancelled, ffmpeg done, parakeet still pending
  state = reducer(state, { type: "retry", plan });
  assert.equal(state.chainState, "running");
  assert.equal(state.currentId, "parakeet");
});

test("reducer cancel-request: no-op when chain not running", () => {
  const plan = fullPlanAllMissing();
  let state = initialState(plan);
  state = reducer(state, { type: "cancel-request", mode: "abort" });
  assert.equal(state.cancelRequested, false);
});

// ---- reducer: reset ---------------------------------------------------------

test("reducer reset: rebuilds state from a new plan", () => {
  const oldPlan = fullPlanAllMissing();
  let state = reducer(initialState(oldPlan), { type: "start", plan: oldPlan });
  state = reducer(state, { type: "succeeded", id: "ffmpeg", plan: oldPlan });

  // User goes back, switches to cloud LLM + drops semantic search; plan
  // shrinks to just ffmpeg.
  const newPlan = deriveRequiredInstalls({
    deps: depsAllMissing(),
    asrProvider: "openai",
    llmProvider: "claude",
    enableSemanticSearch: false,
    localLlmModel: null,
    localLlmInstalled: false,
    embedAlreadyInstalled: false,
  });
  state = reducer(state, { type: "reset", plan: newPlan });
  assert.equal(state.chainState, "idle");
  assert.equal(state.currentId, null);
  assert.deepEqual(Object.keys(state.rows), ["ffmpeg"]);
});
