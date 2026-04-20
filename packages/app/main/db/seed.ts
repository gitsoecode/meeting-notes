import type Database from "better-sqlite3";
import {
  loadRunManifest,
  walkRunFolders,
  createAppLogger,
  type RunManifest,
} from "@gistlist/engine";

const appLogger = createAppLogger(false);

export interface SeedResult {
  imported: number;
  skipped: number;
  errors: string[];
}

/**
 * Populate the SQLite database from existing index.md files on disk.
 * Uses INSERT OR IGNORE so it's safe to run multiple times.
 */
export function seedDbFromFilesystem(
  db: Database.Database,
  runsRoot: string
): SeedResult {
  const start = Date.now();
  const folders = walkRunFolders(runsRoot);
  appLogger.info("Database seed started", {
    detail: `Found ${folders.length} run folders in ${runsRoot}`,
  });

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  const insertRun = db.prepare(`
    INSERT OR IGNORE INTO runs
      (run_id, folder_path, title, description, date, started, ended, status,
       source_mode, duration_minutes, asr_provider, llm_provider, scheduled_time,
       selected_prompts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertOutput = db.prepare(`
    INSERT OR IGNORE INTO prompt_outputs
      (run_id, prompt_output_id, status, filename, label, builtin, error, latency_ms, tokens_used, completed_at, model)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertTag = db.prepare("INSERT OR IGNORE INTO tags (run_id, tag) VALUES (?, ?)");
  const insertAttachment = db.prepare("INSERT OR IGNORE INTO attachments (run_id, filename) VALUES (?, ?)");
  const insertSegment = db.prepare("INSERT OR IGNORE INTO recording_segments (run_id, segment_name, sort_order) VALUES (?, ?, ?)");

  // Coerce a manifest field to something better-sqlite3 can bind. The YAML
  // parser used by gray-matter autoconverts ISO date strings into JS Date
  // objects, which SQLite refuses ("can only bind numbers, strings,
  // bigints, buffers, and null"). Convert Dates back to ISO strings, and
  // map undefined → null defensively.
  const bindable = (v: unknown): string | number | bigint | Buffer | null => {
    if (v == null) return null;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "string" || typeof v === "number" || typeof v === "bigint") return v;
    if (Buffer.isBuffer(v)) return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    // Anything else (object, array) — stringify so we never throw inside the
    // transaction. Better to round-trip imperfectly than to lose the row.
    try {
      return JSON.stringify(v);
    } catch {
      return null;
    }
  };

  // Insert each run independently rather than as a single big transaction,
  // so one malformed manifest can't roll back the entire seed. Each row
  // still uses INSERT OR IGNORE so re-runs are idempotent.
  for (const folder of folders) {
    let manifest: RunManifest;
    try {
      manifest = loadRunManifest(folder);
    } catch (err) {
      const msg = `Failed to parse ${folder}: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(msg);
      continue;
    }

    try {
      const result = insertRun.run(
        bindable(manifest.run_id), bindable(folder), bindable(manifest.title),
        bindable(manifest.description), bindable(manifest.date),
        bindable(manifest.started), bindable(manifest.ended),
        bindable(manifest.status), bindable(manifest.source_mode),
        bindable(manifest.duration_minutes), bindable(manifest.asr_provider),
        bindable(manifest.llm_provider), bindable(manifest.scheduled_time),
        manifest.selected_prompts ? JSON.stringify(manifest.selected_prompts) : null
      );

      if (result.changes === 0) {
        skipped++;
        continue;
      }

      imported++;

      for (const [id, state] of Object.entries(manifest.prompt_outputs)) {
        insertOutput.run(
          bindable(manifest.run_id), bindable(id), bindable(state.status),
          bindable(state.filename), bindable(state.label),
          state.builtin ? 1 : 0, bindable(state.error),
          bindable(state.latency_ms), bindable(state.tokens_used),
          bindable(state.completed_at), bindable(state.model)
        );
      }

      for (const tag of manifest.tags) insertTag.run(bindable(manifest.run_id), bindable(tag));
      for (const a of manifest.attachments) insertAttachment.run(bindable(manifest.run_id), bindable(a));
      for (let i = 0; i < manifest.recording_segments.length; i++) {
        insertSegment.run(bindable(manifest.run_id), bindable(manifest.recording_segments[i]), i);
      }
    } catch (err) {
      const msg = `Failed to insert ${folder}: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(msg);
      appLogger.warn("Seed: skipping bad manifest", { detail: msg });
    }
  }

  const durationMs = Date.now() - start;
  appLogger.info("Database seed completed", {
    detail: `${imported} imported, ${skipped} skipped, ${errors.length} errors in ${durationMs}ms`,
  });

  return { imported, skipped, errors };
}
