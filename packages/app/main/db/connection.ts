import Database from "better-sqlite3";
import path from "node:path";
import { getConfigDir, createAppLogger } from "@meeting-notes/engine";
import { migrate } from "./migrate.js";

const appLogger = createAppLogger(false);
let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = path.join(getConfigDir(), "meetings.db");
  appLogger.info("Opening database", { detail: dbPath });

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  migrate(db);
  return db;
}

export function closeDb(): void {
  if (db) {
    appLogger.info("Closing database");
    db.close();
    db = null;
  }
}
