import path from "node:path";
import type Database from "better-sqlite3";
import { createAppLogger } from "@gistlist/engine";
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
/**
 * In a packaged Electron app, `require.resolve()` for a file inside an
 * unpacked native module returns the path as if it lived inside `app.asar`.
 * Electron transparently routes `fs.*` reads of those paths to
 * `app.asar.unpacked`, but `dlopen()` is a libc syscall that bypasses that
 * translation and fails with ENOTDIR (errno 20) — asar is a single regular
 * file, not a directory. SQLite's `loadExtension` calls dlopen directly,
 * so we must rewrite the path before handing it over.
 */
function unpackAsarPath(p: string): string {
  return p.includes(`${path.sep}app.asar${path.sep}`)
    ? p.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
    : p;
}

export async function loadSqliteVec(db: Database.Database): Promise<void> {
  try {
    // Dynamic import so tests that don't need vec (or platforms where the
    // native binary is missing) don't hard-fail at module load.
    //
    // sqlite-vec is CJS (`module.exports = { getLoadablePath, load }`).
    // Node's ESM-from-CJS static analysis sometimes surfaces those keys as
    // top-level named exports and sometimes doesn't, depending on Node
    // version. The CJS exports object IS always available via `.default`,
    // so prefer that and fall back to the top level. Without this, the
    // packaged build silently fell through to `sqliteVec.load(db)`, which
    // bypasses our asar→app.asar.unpacked path rewrite and fails with
    // dlopen ENOTDIR — sqlite-vec ended up FTS-only in every release.
    const mod = (await import("sqlite-vec")) as {
      getLoadablePath?: () => string;
      load?: (d: Database.Database) => void;
      default?: {
        getLoadablePath?: () => string;
        load?: (d: Database.Database) => void;
      };
    };
    const getLoadablePath =
      mod.getLoadablePath ?? mod.default?.getLoadablePath;
    const loadFn = mod.load ?? mod.default?.load;
    if (typeof getLoadablePath === "function") {
      // Resolve via sqlite-vec's helper, then route through asar.unpacked
      // so dlopen sees a real on-disk file (see comment above).
      const dylibPath = unpackAsarPath(getLoadablePath());
      db.loadExtension(dylibPath);
    } else if (typeof loadFn === "function") {
      // Fallback for older sqlite-vec versions that only expose load(db).
      // Note: this path won't survive packaging because `load()` doesn't
      // route through unpackAsarPath. Reaching it in production is a bug.
      loadFn(db);
    } else {
      throw new Error("sqlite-vec package exposes neither getLoadablePath() nor load()");
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
