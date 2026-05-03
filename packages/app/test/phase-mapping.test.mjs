import test from "node:test";
import assert from "node:assert/strict";

import {
  RAIL_STEPS,
  activePhaseFromLog,
  phaseFromLogLine,
} from "../renderer/src/components/wizard/phaseMapping.mjs";

test("phaseFromLogLine returns null for non-phase lines", () => {
  assert.equal(phaseFromLogLine(""), null);
  assert.equal(phaseFromLogLine("✓ ffmpeg verify-check"), null);
  assert.equal(phaseFromLogLine("  ffmpeg download: 24.3 MB / 24.3 MB"), null);
  assert.equal(phaseFromLogLine("plain log line"), null);
});

test("phaseFromLogLine maps each Parakeet auto-chain phase boundary", () => {
  // Mirrors the lines emitted by setupAsr in packages/app/main/ipc.ts.
  // The rail is 4 steps — speech-model covers both weights-download and
  // smoke-test (one subprocess, no observable boundary). See
  // phaseMapping.mjs's header comment for the rationale.
  assert.equal(
    phaseFromLogLine("→ ensuring ffmpeg + ffprobe"),
    "audio-tools"
  );
  assert.equal(
    phaseFromLogLine("→ ensuring app-managed Python runtime"),
    "python-runtime"
  );
  assert.equal(
    phaseFromLogLine("→ building venv and installing mlx-audio"),
    "venv"
  );
  assert.equal(
    phaseFromLogLine("→ Downloading Parakeet weights"),
    "speech-model"
  );
  // "smoke" alias remains supported in case a future caller emits the
  // older "→ Smoke-testing …" form. Both should land on speech-model
  // (the rail no longer has a separate verify step).
  assert.equal(
    phaseFromLogLine("→ Smoke-testing parakeet venv"),
    "speech-model"
  );
});

test("activePhaseFromLog walks backwards and returns the last phase", () => {
  const log = [
    "→ ensuring ffmpeg + ffprobe",
    "  ✓ ffmpeg + ffprobe already present",
    "→ ensuring app-managed Python runtime",
    "  python download: 17.0 MB / 17.0 MB",
    "  ✓ Python runtime installed",
    "→ building venv and installing mlx-audio",
    "  Building venv…",
  ];
  assert.equal(activePhaseFromLog(log), "venv");
});

test("activePhaseFromLog handles the synthesized speech-model boundary", () => {
  // Real-world stream: ipc.ts wraps engine onLog and synthesizes the
  // `→ Downloading Parakeet weights` boundary when the engine emits
  // its smoke-test start line. Without this synthesis the rail would
  // freeze at "venv" through the entire model download + smoke test.
  const log = [
    "→ ensuring ffmpeg + ffprobe",
    "→ ensuring app-managed Python runtime",
    "→ building venv and installing mlx-audio",
    "  Installing mlx-audio==…",
    "  ✓ Installed: …/mlx_audio.stt.generate",
    "→ Downloading Parakeet weights",
    "  Running smoke test (downloads Parakeet weights on first run, ~600 MB)…",
  ];
  assert.equal(activePhaseFromLog(log), "speech-model");
});

test("activePhaseFromLog returns null for an empty buffer", () => {
  assert.equal(activePhaseFromLog([]), null);
  assert.equal(
    activePhaseFromLog(["plain text", "  ✓ ffmpeg verify-check"]),
    null
  );
});

test("RAIL_STEPS is the canonical Parakeet 4-step order", () => {
  assert.equal(RAIL_STEPS.length, 4);
  assert.deepEqual(
    RAIL_STEPS.map((s) => s.phase),
    ["audio-tools", "python-runtime", "venv", "speech-model"]
  );
});
