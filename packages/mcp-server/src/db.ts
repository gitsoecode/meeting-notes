/**
 * Opens `meetings.db` read-only and best-effort loads the sqlite-vec
 * extension. Mirrors the app's pattern (graceful FTS-only fallback) but
 * never migrates the schema — that's owned by the app.
 */
import Database from "better-sqlite3";

export interface DbHandle {
  db: Database.Database;
  vecAvailable: boolean;
  vecLoadError: string | null;
  close: () => void;
}

export async function openMeetingsDb(dbPath: string): Promise<DbHandle> {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma("query_only = ON");
  db.pragma("busy_timeout = 5000");

  let vecAvailable = false;
  let vecLoadError: string | null = null;
  try {
    const sqliteVec = await import("sqlite-vec");
    if (typeof (sqliteVec as { load?: unknown }).load === "function") {
      (sqliteVec as { load: (d: Database.Database) => void }).load(db);
      vecAvailable = true;
    } else {
      vecLoadError = "sqlite-vec package does not expose a load() function";
    }
  } catch (err) {
    vecLoadError = err instanceof Error ? err.message : String(err);
  }

  return {
    db,
    vecAvailable,
    vecLoadError,
    close: () => {
      try {
        db.close();
      } catch {
        // Ignore close errors at process shutdown.
      }
    },
  };
}

/**
 * Composite fingerprint for the runs list. Polled to detect adds and
 * deletes so the MCP server can fire `notifications/resources/list_changed`.
 * `max(updated_at)` alone misses non-max-row deletes; combining with `count(*)`
 * catches both. Edge case: a delete-plus-add in the same poll window that
 * preserves both values is theoretically possible but not worth designing
 * around in v1 (see plan: docs/plans/mcp-server.md).
 */
export function runsListFingerprint(db: Database.Database): string {
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), '') AS m FROM runs`
      )
      .get() as { n: number; m: string } | undefined;
    if (!row) return "0|";
    return `${row.n}|${row.m}`;
  } catch {
    return "error";
  }
}
