import type Database from "better-sqlite3";
import { createAppLogger } from "@meeting-notes/engine";
import { SCHEMA_V1 } from "./schema.js";

const appLogger = createAppLogger(false);

export function migrate(db: Database.Database): void {
  const version = (db.pragma("user_version", { simple: true }) as number) ?? 0;

  if (version < 1) {
    appLogger.info("Applying database migration v1");
    db.exec(SCHEMA_V1);
    db.pragma("user_version = 1");
    appLogger.info("Database migration v1 applied");
  }

  if (version < 2) {
    appLogger.info("Applying database migration v2");
    db.exec("ALTER TABLE prompt_outputs ADD COLUMN model TEXT");
    db.pragma("user_version = 2");
    appLogger.info("Database migration v2 applied");
  }
}

export function isEmptyDatabase(db: Database.Database): boolean {
  const row = db.prepare("SELECT COUNT(*) as n FROM runs").get() as { n: number };
  return row.n === 0;
}
