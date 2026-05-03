/**
 * Pure helper that maps a streamed install-log line to one of the four
 * Parakeet-chain rail phases (or `null` for lines that aren't phase
 * boundaries). Centralized here so a copy tweak in
 * `packages/app/main/ipc.ts` (where the `→ ensuring …` lines are
 * emitted) can't silently desync the wizard's progress rail.
 *
 * Authored as `.mjs` with JSDoc types so:
 *   1. The renderer's Vite build imports it directly without TS chaining.
 *   2. The unit-test suite (`packages/app/test/*.test.mjs`) can import the
 *      same file without a build step.
 *
 * The four phase identifiers mirror the Parakeet auto-chain phases in
 * `setupAsr` (packages/app/main/ipc.ts):
 *
 *   - "audio-tools"    → ffmpeg + ffprobe install
 *                        (`→ ensuring ffmpeg + ffprobe`)
 *   - "python-runtime" → app-managed CPython 3.12 install
 *                        (`→ ensuring app-managed Python runtime`)
 *   - "venv"           → mlx-audio venv build
 *                        (`→ building venv and installing mlx-audio`)
 *   - "speech-model"   → Parakeet weights download AND verification
 *                        smoke test, combined. Triggered by the
 *                        synthesized `→ Downloading Parakeet weights`
 *                        boundary that ipc.ts emits when the engine
 *                        starts the smoke test.
 *
 * Why no separate "verify" rail step: the smoke test is one Python
 * invocation that loads weights and transcribes in the same subprocess,
 * with no observable boundary between the two. A separate Verify step
 * would either fire too late (only on the success line, after
 * verification has already completed — the user sees Verify "active"
 * for milliseconds) or fire simultaneously with speech-model (visually
 * implying both are running independently). Collapsing into one
 * "Speech model" step is honest about what the wizard observes; the
 * activity stream still surfaces the smoke test's
 * `✓ Smoke test transcription: …` success marker so users see
 * verification happened.
 *
 * Lines that don't start with `→` (substep markers like `✓`/`✘`, raw
 * progress lines) return `null`.
 *
 * @typedef {"audio-tools"|"python-runtime"|"venv"|"speech-model"} RailPhase
 *
 * @param {string} line
 * @returns {RailPhase|null}
 */
export function phaseFromLogLine(line) {
  if (typeof line !== "string") return null;
  if (!line.startsWith("→")) return null;
  const rest = line.slice(1).trim().toLowerCase();
  // Order matters: more specific phrases first.
  if (rest.includes("ffmpeg")) return "audio-tools";
  if (rest.includes("python runtime") || rest.includes("python-runtime")) {
    return "python-runtime";
  }
  if (
    rest.includes("parakeet weights") ||
    rest.includes("downloading parakeet") ||
    rest.includes("smoke")
  ) {
    return "speech-model";
  }
  if (rest.includes("venv") || rest.includes("mlx-audio")) return "venv";
  return null;
}

/**
 * Display order for the rail (left-to-right top-to-bottom). The renderer
 * walks this order to render the step list and to compute "current step"
 * from the most recent phase boundary.
 *
 * @type {ReadonlyArray<{phase: RailPhase, label: string, sub: string}>}
 */
export const RAIL_STEPS = Object.freeze([
  { phase: "audio-tools", label: "Audio tools", sub: "ffmpeg + ffprobe" },
  { phase: "python-runtime", label: "Python runtime", sub: "3.12.13" },
  { phase: "venv", label: "Virtual environment", sub: "mlx-audio" },
  { phase: "speech-model", label: "Speech model", sub: "Download + smoke test" },
]);

/**
 * Given the full log buffer, return the most recent phase boundary
 * encountered. Used by the renderer to compute which rail step is
 * currently active. Returns null if no phase line has appeared yet.
 *
 * @param {readonly string[]} logLines
 * @returns {RailPhase|null}
 */
export function activePhaseFromLog(logLines) {
  for (let i = logLines.length - 1; i >= 0; i--) {
    const phase = phaseFromLogLine(logLines[i]);
    if (phase) return phase;
  }
  return null;
}
