import type Database from "better-sqlite3";
import { createAppLogger } from "@meeting-notes/engine";
import { chatChunksVecSchema } from "./schema.js";

const appLogger = createAppLogger(false);

export const EMBEDDING_DIM = 768; // nomic-embed-text

/**
 * Runtime flag set when sqlite-vec fails to load. Retrieval reads this and
 * falls back to FTS-only (no semantic recall). The chat feature must remain
 * fully functional either way — the fallback is a first-class launch
 * requirement, not just a mitigation.
 */
let vecAvailable = false;
let vecLoadError: string | null = null;

export function isVecAvailable(): boolean {
  return vecAvailable;
}

export function getVecLoadError(): string | null {
  return vecLoadError;
}

/**
 * Attempt to load sqlite-vec into the connection and create the vec0 virtual
 * table. Success → `isVecAvailable()` returns true. Failure → logged once and
 * the feature degrades; `isVecAvailable()` stays false for the app lifetime.
 */
export async function loadSqliteVec(db: Database.Database): Promise<void> {
  try {
    // Dynamic import so tests that don't need vec (or platforms where the
    // native binary is missing) don't hard-fail at module load.
    const sqliteVec = await import("sqlite-vec");
    if (typeof (sqliteVec as { load?: unknown }).load === "function") {
      (sqliteVec as { load: (d: Database.Database) => void }).load(db);
    } else {
      throw new Error("sqlite-vec package does not expose a load() function");
    }
    db.exec(chatChunksVecSchema(EMBEDDING_DIM));
    vecAvailable = true;
    vecLoadError = null;
    appLogger.info("sqlite-vec loaded", { detail: `dim=${EMBEDDING_DIM}` });
  } catch (err) {
    vecAvailable = false;
    vecLoadError = err instanceof Error ? err.message : String(err);
    appLogger.warn("sqlite-vec load failed — falling back to FTS-only retrieval", {
      detail: vecLoadError,
    });
  }
}

/** Reset loader state. Exposed only for tests. */
export function __resetVecLoaderForTests(): void {
  vecAvailable = false;
  vecLoadError = null;
}
