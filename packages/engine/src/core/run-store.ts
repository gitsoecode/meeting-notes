import type { RunManifest, RunStatus, PromptOutputState } from "./run.js";

/**
 * Abstract store for run state. The app provides a SQLite-backed
 * implementation; the CLI uses the filesystem adapter.
 */
export interface RunStore {
  loadManifest(folderPath: string): RunManifest;
  updateStatus(folderPath: string, status: RunStatus, updates?: Partial<RunManifest>): RunManifest;
  updatePromptOutput(folderPath: string, promptOutputId: string, state: PromptOutputState): void;
  insertRun(manifest: RunManifest, folderPath: string): void;
  deleteRun(folderPath: string): void;
  deleteRuns(folderPaths: string[]): void;
  listRuns(): Array<{ manifest: RunManifest; folderPath: string }>;
}
