/**
 * Pure helpers + reducer for the chain-install Dependencies step.
 *
 * Authored as `.mjs` with JSDoc types so:
 *   1. The renderer's Vite build imports it directly without TS chaining.
 *   2. The unit-test suite (`packages/app/test/*.test.mjs`) can import the
 *      same file without a build step.
 *
 * Two pieces live here:
 *
 *   - `deriveRequiredInstalls(input)` — pure function that takes the
 *     wizard's normalized inputs (deps, provider choices, embed/llm
 *     install state) and returns an ordered `RequiredInstall[]` plan.
 *     Splits "what needs to happen" from "how to run it" so the React
 *     hook stays small and the matrix is easy to test.
 *
 *   - `reducer(state, action)` + `initialState(plan)` — the chain state
 *     machine. The hook owns side effects (running dispatchers, listening
 *     to progress IPC); the reducer owns transitions only. Keeping them
 *     split means the matrix of "ordered execution / cancel-graceful /
 *     failure-halt-then-retry / progress-snapshot-forwarding" is a pure
 *     unit test against synchronous dispatch.
 *
 * @typedef {"ffmpeg"|"parakeet"|"ollama"|"embed-model"|"local-llm"} DepId
 *
 * @typedef {object} RequiredInstall
 * @property {DepId} id
 * @property {string} name             Display name, e.g. "ffmpeg + ffprobe"
 * @property {number} estimatedBytes   Used for the upfront "Install all (~X)"
 *                                     total. 0 if unknown.
 * @property {boolean} alreadyReady    True when the dep is already installed
 *                                     before this page — chain skips it.
 * @property {string} [meta]           Optional sub-label, e.g. "1 GB · ASR".
 *
 * @typedef {object} ProgressSnapshot
 * @property {string} [phase]    e.g. "Downloading" / "Verifying" / "Building venv"
 * @property {string} [label]    Human-readable current step
 * @property {{done: number, total: number|null}} [bytes]
 * @property {number} [percent]  0..100, used when bytes unavailable
 * @property {number} [speed]    bytes/sec
 * @property {number} [eta]      seconds remaining
 *
 * @typedef {{kind: "pending"}
 *           | {kind: "ready"}
 *           | {kind: "running", progress: ProgressSnapshot|null}
 *           | {kind: "done"}
 *           | {kind: "failed", error: string}
 *           | {kind: "cancelled"}} RowState
 *
 * @typedef {"idle"|"running"|"paused"|"cancelled"|"done"} ChainState
 *
 * @typedef {"abort"|"graceful"|null} CancelMode
 *
 * @typedef {object} ChainStateShape
 * @property {ChainState} chainState
 * @property {Record<DepId, RowState>} rows
 * @property {DepId|null} currentId
 * @property {boolean} cancelRequested
 * @property {CancelMode} cancelMode      Set alongside `cancelRequested`. "abort"
 *                                         when the active dep was actively aborted
 *                                         (Parakeet's setup-asr signal), "graceful"
 *                                         when we're waiting for the active install
 *                                         to finish on its own. Determines whether a
 *                                         subsequent `failed` is reclassified as
 *                                         `cancelled` (abort only) or surfaces as a
 *                                         real failure (graceful — the install
 *                                         genuinely failed, not because of cancel).
 */

/**
 * Fixed install order. Matches the existing prereq chain used by the
 * per-row Dependencies step:
 *   1. ffmpeg always first (engine + Parakeet smoke test depend on it)
 *   2. Parakeet (Apple Silicon ASR — auto-chains ffmpeg + Python internally,
 *      but the chain-level row reflects the user-visible "Parakeet" install)
 *   3. Ollama (semantic search OR llmProvider=ollama)
 *   4. Embedding model (semantic search; needs Ollama daemon)
 *   5. Local LLM model (llmProvider=ollama; needs Ollama daemon)
 *
 * @type {ReadonlyArray<DepId>}
 */
export const INSTALL_ORDER = Object.freeze([
  "ffmpeg",
  "parakeet",
  "ollama",
  "embed-model",
  "local-llm",
]);

/**
 * A binary at <binDir>/X with `verified === "system-unverified"` is the
 * app-managed-broken state — usually wrong arch after a UTM/Rosetta swap
 * or after migrating an Intel install. The chain treats it as
 * not-already-ready so the next Install pass repairs it.
 *
 * @param {{path: string|null, source?: string|null, verified?: string}} tool
 * @returns {boolean}
 */
function isToolReady(tool) {
  if (!tool.path) return false;
  const isAppManaged =
    tool.source === "app-installed" || tool.source === "bundled";
  if (isAppManaged && tool.verified === "system-unverified") return false;
  return true;
}

/**
 * Compute the ordered list of required installs from the wizard's
 * normalized inputs. Pure — no IPC, no React. Easy to exhaustively unit
 * test across provider permutations.
 *
 * Booleans like `embedAlreadyInstalled` and `localLlmInstalled` are
 * pre-computed by the caller because they require a custom matcher
 * (`localModelIdsMatch`) that isn't worth pulling into this helper.
 *
 * @param {object} input
 * @param {{
 *   ffmpeg: {path: string|null, source?: string|null, verified?: string},
 *   ffprobe: {path: string|null, source?: string|null, verified?: string},
 *   parakeet: {path: string|null, source?: string|null, verified?: string},
 *   python?: {path: string|null, source?: string|null, verified?: string},
 *   ollama: {daemon: boolean, verified?: string},
 * }} input.deps
 * @param {string} input.asrProvider                 e.g. "parakeet-mlx" | "openai" | "whisper-local"
 * @param {string} input.llmProvider                 e.g. "ollama" | "claude" | "openai"
 * @param {boolean} input.enableSemanticSearch
 * @param {string|null} input.localLlmModel          Selected local LLM model id, or null
 * @param {boolean} input.localLlmInstalled          True when the selected model is in the daemon
 * @param {boolean} input.embedAlreadyInstalled
 * @param {number|null} [input.localLlmSizeGb]       Size of selected local LLM in GB (~5 if unknown)
 * @returns {RequiredInstall[]}
 */
export function deriveRequiredInstalls(input) {
  /** @type {RequiredInstall[]} */
  const list = [];

  // ffmpeg — always required: engine code paths use it for every recording.
  // Both ffmpeg AND ffprobe must be present and pass the app-managed-arch
  // check; a half-installed pair forces re-install.
  list.push({
    id: "ffmpeg",
    name: "ffmpeg + ffprobe",
    estimatedBytes: 50 * 1024 * 1024, // ~50 MB
    alreadyReady:
      isToolReady(input.deps.ffmpeg) && isToolReady(input.deps.ffprobe),
  });

  // Parakeet — only when the user picked it as their ASR provider.
  // (Apple Silicon gate is enforced upstream — `asrProvider` auto-switches
  // to "openai" on Intel before reaching this step.)
  // Treat the row as not-ready if EITHER the venv binary is missing OR
  // the underlying app-managed Python failed validation. The venv is
  // built against that Python, so a wrong-arch Python means the venv
  // can't load — re-running the Parakeet chain reinstalls Python and
  // rebuilds the venv against it.
  if (input.asrProvider === "parakeet-mlx") {
    const pythonOk = input.deps.python ? isToolReady(input.deps.python) : true;
    list.push({
      id: "parakeet",
      name: "Parakeet",
      estimatedBytes: 1 * 1024 * 1024 * 1024, // ~1 GB (Python + venv + weights)
      alreadyReady: isToolReady(input.deps.parakeet) && pythonOk,
    });
  }

  // Ollama — needed for either local LLM chat OR the embedding model.
  // The embedding model lives inside Ollama regardless of LLM provider.
  // Daemon answering on :11434 is the operational signal — that's what
  // `deps.ollama.daemon` is set from in main.
  if (input.enableSemanticSearch || input.llmProvider === "ollama") {
    list.push({
      id: "ollama",
      name: "Ollama",
      estimatedBytes: 130 * 1024 * 1024, // ~130 MB
      alreadyReady: !!input.deps.ollama.daemon,
    });
  }

  // Embedding model — explicit since v0.1.9. Requires Ollama daemon.
  if (input.enableSemanticSearch) {
    list.push({
      id: "embed-model",
      name: "Embedding model (nomic-embed-text)",
      estimatedBytes: 274 * 1024 * 1024, // ~274 MB
      alreadyReady: !!input.embedAlreadyInstalled,
    });
  }

  // Local LLM model — only when the user picked Ollama AND chose a model.
  if (input.llmProvider === "ollama" && input.localLlmModel) {
    const sizeGb = typeof input.localLlmSizeGb === "number" ? input.localLlmSizeGb : 5;
    list.push({
      id: "local-llm",
      name: `Model: ${input.localLlmModel}`,
      estimatedBytes: Math.round(sizeGb * 1024 * 1024 * 1024),
      alreadyReady: !!input.localLlmInstalled,
    });
  }

  return list;
}

/**
 * Sum the bytes still to install (rows with `alreadyReady === false`).
 * Used for the upfront "Install all (~X)" button label.
 *
 * @param {ReadonlyArray<RequiredInstall>} plan
 * @returns {number}
 */
export function totalRemainingBytes(plan) {
  let total = 0;
  for (const item of plan) {
    if (!item.alreadyReady) total += item.estimatedBytes;
  }
  return total;
}

/**
 * Build the initial state from a plan: each row is `ready` (already
 * installed before this page) or `pending` (queued).
 *
 * @param {ReadonlyArray<RequiredInstall>} plan
 * @returns {ChainStateShape}
 */
export function initialState(plan) {
  /** @type {Record<string, RowState>} */
  const rows = {};
  for (const item of plan) {
    rows[item.id] = item.alreadyReady ? { kind: "ready" } : { kind: "pending" };
  }
  return {
    chainState: "idle",
    rows: /** @type {Record<DepId, RowState>} */ (rows),
    currentId: null,
    cancelRequested: false,
    cancelMode: null,
  };
}

/**
 * First `pending` row in plan order, or null if none. The chain runs in
 * fixed order — never reorders mid-flight.
 *
 * @param {ReadonlyArray<RequiredInstall>} plan
 * @param {Record<string, RowState>} rows
 * @returns {DepId|null}
 */
export function nextPendingId(plan, rows) {
  for (const item of plan) {
    if (rows[item.id]?.kind === "pending") {
      return /** @type {DepId} */ (item.id);
    }
  }
  return null;
}

/**
 * @typedef {{type: "start", plan: ReadonlyArray<RequiredInstall>}
 *           | {type: "progress", id: DepId, snapshot: ProgressSnapshot|null}
 *           | {type: "succeeded", id: DepId, plan: ReadonlyArray<RequiredInstall>}
 *           | {type: "failed", id: DepId, error: string}
 *           | {type: "cancel-request", mode: "abort"|"graceful"}
 *           | {type: "retry", plan: ReadonlyArray<RequiredInstall>}
 *           | {type: "reset", plan: ReadonlyArray<RequiredInstall>}} ChainAction
 */

/**
 * State machine reducer. Pure — `(state, action) => state`.
 *
 * @param {ChainStateShape} state
 * @param {ChainAction} action
 * @returns {ChainStateShape}
 */
export function reducer(state, action) {
  switch (action.type) {
    case "start": {
      const next = nextPendingId(action.plan, state.rows);
      if (!next) {
        return { ...state, chainState: "done" };
      }
      return {
        ...state,
        chainState: "running",
        currentId: next,
        cancelRequested: false,
        rows: {
          ...state.rows,
          [next]: { kind: "running", progress: null },
        },
      };
    }

    case "progress": {
      const row = state.rows[action.id];
      if (!row || row.kind !== "running") return state;
      return {
        ...state,
        rows: {
          ...state.rows,
          [action.id]: { kind: "running", progress: action.snapshot },
        },
      };
    }

    case "succeeded": {
      const newRows = { ...state.rows, [action.id]: { kind: "done" } };
      // If user requested cancel mid-install, the dep finished cleanly
      // before we could stop it. Mark the chain cancelled — but the
      // successful row stays `done` (it really did finish). Holds for
      // both abort and graceful modes; either way we're stopping.
      if (state.cancelRequested) {
        return {
          ...state,
          chainState: "cancelled",
          rows: newRows,
          currentId: null,
          cancelRequested: false,
          cancelMode: null,
        };
      }
      const next = nextPendingId(action.plan, newRows);
      if (!next) {
        return {
          ...state,
          chainState: "done",
          rows: newRows,
          currentId: null,
        };
      }
      return {
        ...state,
        chainState: "running",
        currentId: next,
        rows: {
          ...newRows,
          [next]: { kind: "running", progress: null },
        },
      };
    }

    case "failed": {
      // Reclassify as `cancelled` ONLY when the user actually aborted
      // the active install (cancelMode === "abort"). For graceful
      // cancels (non-cancellable dep, user just requested stop while
      // it ran) the dep can still genuinely fail — that's a real error
      // the user needs to see, not something to silently mark
      // `cancelled`. Letting graceful failures fall through preserves
      // the Retry/error-detail UX.
      const wasAbort =
        state.cancelRequested &&
        state.cancelMode === "abort" &&
        state.currentId === action.id;
      const finalKind = wasAbort
        ? /** @type {RowState} */ ({ kind: "cancelled" })
        : /** @type {RowState} */ ({ kind: "failed", error: action.error });
      return {
        ...state,
        chainState: wasAbort ? "cancelled" : "paused",
        rows: { ...state.rows, [action.id]: finalKind },
        currentId: null,
        cancelRequested: false,
        cancelMode: null,
      };
    }

    case "cancel-request": {
      // Set the flag + mode; the actual stop happens after the current
      // dep returns/throws. Idempotent — multiple clicks of the same
      // mode keep the flag set without changes. Mode is "abort" for
      // installs with a real cancel signal (Parakeet today), "graceful"
      // for installs we let finish on their own (ffmpeg/Ollama/models).
      if (state.chainState !== "running") return state;
      return {
        ...state,
        cancelRequested: true,
        cancelMode: action.mode,
      };
    }

    case "retry": {
      // Reset failed/cancelled rows to pending and resume from the first
      // remaining pending row. Done/Ready rows are preserved.
      /** @type {Record<string, RowState>} */
      const newRows = {};
      for (const id of Object.keys(state.rows)) {
        const row = state.rows[id];
        if (row.kind === "failed" || row.kind === "cancelled") {
          newRows[id] = { kind: "pending" };
        } else {
          newRows[id] = row;
        }
      }
      const next = nextPendingId(action.plan, newRows);
      if (!next) {
        return {
          ...state,
          chainState: "done",
          rows: /** @type {Record<DepId, RowState>} */ (newRows),
          currentId: null,
        };
      }
      return {
        ...state,
        chainState: "running",
        currentId: next,
        cancelRequested: false,
        cancelMode: null,
        rows: {
          .../** @type {Record<DepId, RowState>} */ (newRows),
          [next]: { kind: "running", progress: null },
        },
      };
    }

    case "reset": {
      // Re-init from a new plan. Caller should only invoke this when
      // chainState !== "running" — the hook enforces that gate.
      return initialState(action.plan);
    }

    default:
      return state;
  }
}
