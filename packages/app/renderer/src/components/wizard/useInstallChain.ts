import { useEffect, useReducer, useRef } from "react";
import type {
  DepId,
  RequiredInstall,
  ProgressSnapshot,
  ChainStateShape,
  ChainAction,
} from "./installChain.types";
// Runtime helpers from the .mjs sibling. The reducer + initial-state
// builder live there alongside the pure plan-derivation function so the
// node:test suite can exercise the state machine without a build step.
// The .mjs has JSDoc types only, so tsc resolves it as `any` — we cast
// to the proper TS types below. Same pattern as `phaseMapping.mjs`.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — .mjs without .d.ts
import * as installChainImpl from "./installChain.mjs";

const initialStateFn = installChainImpl.initialState as (
  plan: readonly RequiredInstall[],
) => ChainStateShape;
const reducerFn = installChainImpl.reducer as (
  state: ChainStateShape,
  action: ChainAction,
) => ChainStateShape;

export type DispatcherMap = Partial<Record<DepId, () => Promise<void>>>;

interface UseInstallChainOptions {
  /**
   * Ordered list of installs computed by `deriveRequiredInstalls`. Treated
   * as stable for the duration of the chain — the hook resets state when
   * the plan signature changes AND `chainState` is not `"running"`.
   */
  plan: readonly RequiredInstall[];
  /**
   * Per-dep async install action. Resolves on success; rejects on failure.
   * The hook is agnostic to the underlying IPC — callers wire whichever
   * existing helper (`installDep`, `installParakeet`, etc.) they already
   * own. Keeping this map lookup-based instead of a single dispatcher with
   * an `id` arg makes the contract explicit ("you must wire all expected
   * ids") and makes unit tests trivial (stub map).
   */
  dispatchers: DispatcherMap;
  /**
   * Fired when the user clicks Cancel AND `isCancellable(activeId)` is
   * true. The caller is responsible for aborting the active dispatcher
   * (e.g. `api.cancelSetupAsr()` for Parakeet). The hook itself only
   * tracks the cancel request and reclassifies the row state in the
   * reducer based on `isCancellable`'s answer.
   */
  onCancel?: (activeId: DepId) => void;
  /**
   * Predicate the hook calls when the user clicks Cancel to determine
   * whether the active dep supports a real abort signal. When true, the
   * row's eventual failure is treated as `cancelled`; when false, a
   * subsequent failure is a real error (the install genuinely broke,
   * not because of the user's request).
   *
   * Defaults to `() => false` — without this, every cancel runs in
   * graceful mode and a real install failure during a graceful cancel
   * is preserved as `failed`. Callers wire this to an explicit set of
   * cancellable dep ids (today: only `parakeet`).
   */
  isCancellable?: (id: DepId) => boolean;
}

export interface UseInstallChainReturn {
  chainState: ChainStateShape["chainState"];
  rows: ChainStateShape["rows"];
  currentId: DepId | null;
  cancelRequested: boolean;
  start: () => void;
  retry: () => void;
  cancel: () => void;
  setProgress: (id: DepId, snapshot: ProgressSnapshot | null) => void;
}

function planSignature(plan: readonly RequiredInstall[]): string {
  return plan.map((p) => `${p.id}:${p.alreadyReady ? "1" : "0"}`).join("|");
}

/**
 * React hook that owns the chain-install state machine. Reducer is the
 * pure piece in `installChain.mjs`; this wraps it with side effects:
 *   - Runs the active dispatcher when `currentId` changes
 *   - Resets state when the plan signature changes (between visits to
 *     the Deps step, e.g. after the user toggles semantic search)
 *   - Exposes `setProgress` so the caller can forward IPC events from
 *     `installer-progress` and `setup-llm:progress` into the matching row
 */
export function useInstallChain({
  plan,
  dispatchers,
  onCancel,
  isCancellable,
}: UseInstallChainOptions): UseInstallChainReturn {
  const [state, dispatch] = useReducer(
    reducerFn,
    plan,
    initialStateFn,
  );

  // Latest dispatchers — read inside the effect without triggering it.
  const dispatchersRef = useRef(dispatchers);
  dispatchersRef.current = dispatchers;

  // Latest plan, similarly. The effect below re-fires only when
  // `currentId` changes, but it needs the current plan for the
  // succeeded/failed dispatch.
  const planRef = useRef(plan);
  planRef.current = plan;

  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  const isCancellableRef = useRef(isCancellable);
  isCancellableRef.current = isCancellable;

  // Reset the reducer state when the plan changes (e.g. user goes back
  // and toggles semantic search). Skip if the chain is mid-run — plan
  // shouldn't change there, and if it somehow did we'd rather not throw
  // away in-flight progress.
  const lastSigRef = useRef(planSignature(plan));
  useEffect(() => {
    const sig = planSignature(plan);
    if (sig === lastSigRef.current) return;
    lastSigRef.current = sig;
    if (state.chainState === "running") return;
    dispatch({ type: "reset", plan });
  }, [plan, state.chainState]);

  // Run the active dispatcher whenever `currentId` becomes non-null.
  // The reducer drives this — `start` / `succeeded` / `retry` all set
  // the next pending id, and this effect fires the dispatcher and
  // reports back via `succeeded` / `failed`.
  useEffect(() => {
    const id = state.currentId;
    if (id === null) return;
    const fn = dispatchersRef.current[id];
    if (!fn) {
      dispatch({
        type: "failed",
        id,
        error: `No dispatcher registered for "${id}"`,
      });
      return;
    }
    let abandoned = false;
    fn().then(
      () => {
        if (abandoned) return;
        dispatch({ type: "succeeded", id, plan: planRef.current });
      },
      (err: unknown) => {
        if (abandoned) return;
        const error = err instanceof Error ? err.message : String(err);
        dispatch({ type: "failed", id, error });
      },
    );
    return () => {
      // The hook is unmounting (or currentId is changing). The async
      // result will land in dev-mode StrictMode double-mount but the
      // reducer ignores `succeeded`/`failed` for a row that's no longer
      // `running`, so the late dispatch is a no-op.
      abandoned = true;
    };
  }, [state.currentId]);

  return {
    chainState: state.chainState,
    rows: state.rows,
    currentId: state.currentId,
    cancelRequested: state.cancelRequested,
    start: () => dispatch({ type: "start", plan }),
    retry: () => dispatch({ type: "retry", plan }),
    cancel: () => {
      const active = state.currentId;
      const cancellable =
        active != null && (isCancellableRef.current?.(active) ?? false);
      dispatch({
        type: "cancel-request",
        mode: cancellable ? "abort" : "graceful",
      });
      // Only invoke the abort callback when the active install actually
      // supports it. For graceful cancels we let the install finish on
      // its own — calling onCancel anyway would be a misleading no-op
      // for non-cancellable deps.
      if (active && cancellable && onCancelRef.current) {
        onCancelRef.current(active);
      }
    },
    setProgress: (id, snapshot) =>
      dispatch({ type: "progress", id, snapshot }),
  };
}
