import Database from "better-sqlite3";
import path from "node:path";
import { getConfigDir, createAppLogger } from "@gistlist/engine";
import { migrate } from "./migrate.js";
import { loadSqliteVec } from "./sqlite-vec-loader.js";

const appLogger = createAppLogger(false);
let db: Database.Database | null = null;
let vecLoadPromise: Promise<void> | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = path.join(getConfigDir(), "meetings.db");
  appLogger.info("Opening database", { detail: dbPath });

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  migrate(db);

  // Kick off sqlite-vec load in the background. Retrieval reads
  // `isVecAvailable()` and falls back to FTS-only if this fails or hasn't
  // resolved yet.
  if (!vecLoadPromise) {
    vecLoadPromise = loadSqliteVec(db);
  }

  return db;
}

/**
 * Await the in-flight sqlite-vec extension load (no-op if already settled).
 * Retrieval calls this before hitting the vec table so we don't race the
 * async load on cold start.
 */
export async function awaitSqliteVec(): Promise<void> {
  if (!db) getDb();
  if (vecLoadPromise) await vecLoadPromise;
}

export function closeDb(): void {
  if (db) {
    appLogger.info("Closing database");
    db.close();
    db = null;
    vecLoadPromise = null;
  }
}
