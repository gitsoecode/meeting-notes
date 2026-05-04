/**
 * TypeScript type companions to `installChain.mjs`. The .mjs file is the
 * runtime + JSDoc source of truth (it has to be node:test-importable
 * without a build step), but TS callers benefit from real types here.
 *
 * Keep these in sync with the JSDoc typedefs in `installChain.mjs`.
 */

export type DepId =
  | "ffmpeg"
  | "parakeet"
  | "ollama"
  | "embed-model"
  | "local-llm";

export interface RequiredInstall {
  id: DepId;
  name: string;
  estimatedBytes: number;
  alreadyReady: boolean;
  meta?: string;
}

export interface ProgressSnapshot {
  phase?: string;
  label?: string;
  bytes?: { done: number; total: number | null };
  percent?: number;
  speed?: number;
  eta?: number;
}

export type RowState =
  | { kind: "pending" }
  | { kind: "ready" }
  | { kind: "running"; progress: ProgressSnapshot | null }
  | { kind: "done" }
  | { kind: "failed"; error: string }
  | { kind: "cancelled" };

export type ChainState =
  | "idle"
  | "running"
  | "paused"
  | "cancelled"
  | "done";

export type CancelMode = "abort" | "graceful" | null;

export interface ChainStateShape {
  chainState: ChainState;
  rows: Record<DepId, RowState>;
  currentId: DepId | null;
  cancelRequested: boolean;
  cancelMode: CancelMode;
}

export type ChainAction =
  | { type: "start"; plan: readonly RequiredInstall[] }
  | { type: "progress"; id: DepId; snapshot: ProgressSnapshot | null }
  | { type: "succeeded"; id: DepId; plan: readonly RequiredInstall[] }
  | { type: "failed"; id: DepId; error: string }
  | { type: "cancel-request"; mode: "abort" | "graceful" }
  | { type: "retry"; plan: readonly RequiredInstall[] }
  | { type: "reset"; plan: readonly RequiredInstall[] };
