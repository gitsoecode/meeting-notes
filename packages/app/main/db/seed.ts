import type Database from "better-sqlite3";
import {
  loadRunManifest,
  walkRunFolders,
  createAppLogger,
  type RunManifest,
} from "@meeting-notes/engine";

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

  const seedAll = db.transaction(() => {
    for (const folder of folders) {
      let manifest: RunManifest;
      try {
        manifest = loadRunManifest(folder);
      } catch (err) {
        const msg = `Failed to parse ${folder}: ${err instanceof Error ? err.message : String(err)}`;
        errors.push(msg);
        continue;
      }

      const result = insertRun.run(
        manifest.run_id, folder, manifest.title, manifest.description,
        manifest.date, manifest.started, manifest.ended, manifest.status,
        manifest.source_mode, manifest.duration_minutes, manifest.asr_provider,
        manifest.llm_provider, manifest.scheduled_time,
        manifest.selected_prompts ? JSON.stringify(manifest.selected_prompts) : null
      );

      if (result.changes === 0) {
        skipped++;
        continue;
      }

      imported++;

      // Prompt outputs (supports both old `sections` key and new `prompt_outputs`)
      for (const [id, state] of Object.entries(manifest.prompt_outputs)) {
        insertOutput.run(
          manifest.run_id, id, state.status, state.filename,
          state.label ?? null, state.builtin ? 1 : 0, state.error ?? null,
          state.latency_ms ?? null, state.tokens_used ?? null, state.completed_at ?? null,
          state.model ?? null
        );
      }

      for (const tag of manifest.tags) insertTag.run(manifest.run_id, tag);
      for (const a of manifest.attachments) insertAttachment.run(manifest.run_id, a);
      for (let i = 0; i < manifest.recording_segments.length; i++) {
        insertSegment.run(manifest.run_id, manifest.recording_segments[i], i);
      }
    }
  });

  seedAll();

  const durationMs = Date.now() - start;
  appLogger.info("Database seed completed", {
    detail: `${imported} imported, ${skipped} skipped, ${errors.length} errors in ${durationMs}ms`,
  });

  return { imported, skipped, errors };
}
