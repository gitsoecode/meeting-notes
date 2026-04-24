import type Database from "better-sqlite3";
import { createAppLogger } from "@gistlist/engine";
import { SCHEMA_V1, SCHEMA_V4_CHAT } from "./schema.js";

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

  if (version < 3) {
    appLogger.info("Applying database migration v3");
    const cols = db.pragma("table_info(runs)") as Array<{ name: string }>;
    const hasUpdatedAt = cols.some((c) => c.name === "updated_at");
    if (!hasUpdatedAt) {
      db.exec("ALTER TABLE runs ADD COLUMN updated_at TEXT");
    }
    db.exec(`
      UPDATE runs SET updated_at = COALESCE(ended, started, date) WHERE updated_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_runs_updated_at ON runs(updated_at DESC);
    `);
    db.pragma("user_version = 3");
    appLogger.info("Database migration v3 applied");
  }

  if (version < 4) {
    appLogger.info("Applying database migration v4 (chat index)");
    db.exec(SCHEMA_V4_CHAT);
    db.pragma("user_version = 4");
    appLogger.info("Database migration v4 applied");
  }

  if (version < 5) {
    // v5: the in-app Chat surface was deprecated in favor of Claude Desktop
    // via MCP. Drop its thread/message tables. The `chat_chunks*` and
    // `chat_index_meta` tables stay — they back MCP's semantic search.
    appLogger.info(
      "Applying database migration v5 (drop chat_threads/chat_messages; in-app chat deprecated)"
    );
    db.exec(`
      DROP TABLE IF EXISTS chat_messages;
      DROP TABLE IF EXISTS chat_threads;
    `);
    db.pragma("user_version = 5");
    appLogger.info("Database migration v5 applied");
  }
}

export function isEmptyDatabase(db: Database.Database): boolean {
  const row = db.prepare("SELECT COUNT(*) as n FROM runs").get() as { n: number };
  return row.n === 0;
}
