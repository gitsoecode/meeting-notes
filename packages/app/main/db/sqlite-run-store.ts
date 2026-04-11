import type Database from "better-sqlite3";
import type { RunStore } from "@meeting-notes/engine";
import type { RunManifest, RunStatus, PromptOutputState } from "@meeting-notes/engine";
import { regenerateIndexMd } from "./index-md-writer.js";

export class SqliteRunStore implements RunStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  loadManifest(folderPath: string): RunManifest {
    const row = this.db.prepare("SELECT * FROM runs WHERE folder_path = ?").get(folderPath) as RunRow | undefined;
    if (!row) throw new Error(`Run not found for folder: ${folderPath}`);
    return this.assembleManifest(row);
  }

  updateStatus(folderPath: string, status: RunStatus, updates?: Partial<RunManifest>): RunManifest {
    const row = this.db.prepare("SELECT * FROM runs WHERE folder_path = ?").get(folderPath) as RunRow | undefined;
    if (!row) throw new Error(`Run not found for folder: ${folderPath}`);

    const manifest = this.assembleManifest(row);
    manifest.status = status;
    if (updates) Object.assign(manifest, updates);

    const updateRun = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE runs SET
          title = ?, description = ?, date = ?, started = ?, ended = ?,
          status = ?, source_mode = ?, duration_minutes = ?,
          asr_provider = ?, llm_provider = ?, scheduled_time = ?,
          selected_prompts = ?
        WHERE run_id = ?
      `).run(
        manifest.title, manifest.description, manifest.date, manifest.started,
        manifest.ended, manifest.status, manifest.source_mode, manifest.duration_minutes,
        manifest.asr_provider, manifest.llm_provider, manifest.scheduled_time,
        manifest.selected_prompts ? JSON.stringify(manifest.selected_prompts) : null,
        manifest.run_id
      );

      // Sync junction tables
      this.syncTags(manifest.run_id, manifest.tags);
      this.syncAttachments(manifest.run_id, manifest.attachments);
      this.syncRecordingSegments(manifest.run_id, manifest.recording_segments);
    });
    updateRun();

    regenerateIndexMd(folderPath, manifest);
    return manifest;
  }

  updatePromptOutput(folderPath: string, promptOutputId: string, state: PromptOutputState): void {
    const row = this.db.prepare("SELECT run_id FROM runs WHERE folder_path = ?").get(folderPath) as { run_id: string } | undefined;
    if (!row) throw new Error(`Run not found for folder: ${folderPath}`);

    this.db.prepare(`
      INSERT OR REPLACE INTO prompt_outputs
        (run_id, prompt_output_id, status, filename, label, builtin, error, latency_ms, tokens_used, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.run_id, promptOutputId, state.status, state.filename,
      state.label ?? null, state.builtin ? 1 : 0, state.error ?? null,
      state.latency_ms ?? null, state.tokens_used ?? null, state.completed_at ?? null
    );

    // Regenerate index.md with full manifest
    const manifest = this.assembleManifest(
      this.db.prepare("SELECT * FROM runs WHERE run_id = ?").get(row.run_id) as RunRow
    );
    regenerateIndexMd(folderPath, manifest);
  }

  insertRun(manifest: RunManifest, folderPath: string): void {
    const insert = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO runs
          (run_id, folder_path, title, description, date, started, ended, status,
           source_mode, duration_minutes, asr_provider, llm_provider, scheduled_time,
           selected_prompts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        manifest.run_id, folderPath, manifest.title, manifest.description,
        manifest.date, manifest.started, manifest.ended, manifest.status,
        manifest.source_mode, manifest.duration_minutes, manifest.asr_provider,
        manifest.llm_provider, manifest.scheduled_time,
        manifest.selected_prompts ? JSON.stringify(manifest.selected_prompts) : null
      );

      // Prompt outputs
      for (const [id, state] of Object.entries(manifest.prompt_outputs)) {
        this.db.prepare(`
          INSERT INTO prompt_outputs
            (run_id, prompt_output_id, status, filename, label, builtin, error, latency_ms, tokens_used, completed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          manifest.run_id, id, state.status, state.filename,
          state.label ?? null, state.builtin ? 1 : 0, state.error ?? null,
          state.latency_ms ?? null, state.tokens_used ?? null, state.completed_at ?? null
        );
      }

      this.syncTags(manifest.run_id, manifest.tags);
      this.syncAttachments(manifest.run_id, manifest.attachments);
      this.syncRecordingSegments(manifest.run_id, manifest.recording_segments);
    });
    insert();
  }

  deleteRun(folderPath: string): void {
    this.db.prepare("DELETE FROM runs WHERE folder_path = ?").run(folderPath);
  }

  deleteRuns(folderPaths: string[]): void {
    const del = this.db.transaction(() => {
      const stmt = this.db.prepare("DELETE FROM runs WHERE folder_path = ?");
      for (const fp of folderPaths) stmt.run(fp);
    });
    del();
  }

  listRuns(): Array<{ manifest: RunManifest; folderPath: string }> {
    const rows = this.db.prepare("SELECT * FROM runs ORDER BY started DESC").all() as RunRow[];
    // Batch-load all prompt outputs for efficiency
    const allOutputs = this.db.prepare("SELECT * FROM prompt_outputs").all() as PromptOutputRow[];
    const outputsByRun = new Map<string, Record<string, PromptOutputState>>();
    for (const o of allOutputs) {
      let map = outputsByRun.get(o.run_id);
      if (!map) { map = {}; outputsByRun.set(o.run_id, map); }
      map[o.prompt_output_id] = rowToPromptOutputState(o);
    }

    return rows.map((row) => ({
      manifest: this.assembleManifestWithOutputs(row, outputsByRun.get(row.run_id) ?? {}),
      folderPath: row.folder_path,
    }));
  }

  searchRuns(query: string): Array<{ manifest: RunManifest; folderPath: string }> {
    const rows = this.db.prepare(`
      SELECT r.* FROM runs r
      INNER JOIN runs_fts ON r.rowid = runs_fts.rowid
      WHERE runs_fts MATCH ?
      ORDER BY r.started DESC
    `).all(query) as RunRow[];

    return rows.map((row) => ({
      manifest: this.assembleManifest(row),
      folderPath: row.folder_path,
    }));
  }

  // ---- Private helpers ----

  private assembleManifest(row: RunRow): RunManifest {
    const outputs = this.db.prepare(
      "SELECT * FROM prompt_outputs WHERE run_id = ?"
    ).all(row.run_id) as PromptOutputRow[];
    const outputMap: Record<string, PromptOutputState> = {};
    for (const o of outputs) outputMap[o.prompt_output_id] = rowToPromptOutputState(o);

    return this.assembleManifestWithOutputs(row, outputMap);
  }

  private assembleManifestWithOutputs(
    row: RunRow,
    promptOutputs: Record<string, PromptOutputState>
  ): RunManifest {
    const tags = (this.db.prepare(
      "SELECT tag FROM tags WHERE run_id = ?"
    ).all(row.run_id) as { tag: string }[]).map((t) => t.tag);

    const attachments = (this.db.prepare(
      "SELECT filename FROM attachments WHERE run_id = ?"
    ).all(row.run_id) as { filename: string }[]).map((a) => a.filename);

    const segments = (this.db.prepare(
      "SELECT segment_name FROM recording_segments WHERE run_id = ? ORDER BY sort_order"
    ).all(row.run_id) as { segment_name: string }[]).map((s) => s.segment_name);

    // For now, participants are stored as simple strings in the manifest.
    // The normalized participants table is available for future use.
    const participants: string[] = [];

    return {
      run_id: row.run_id,
      title: row.title,
      description: row.description,
      date: row.date,
      started: row.started,
      ended: row.ended,
      status: row.status as RunStatus,
      source_mode: row.source_mode as "both" | "mic" | "file",
      tags,
      participants,
      duration_minutes: row.duration_minutes,
      asr_provider: row.asr_provider,
      llm_provider: row.llm_provider,
      prompt_outputs: promptOutputs,
      scheduled_time: row.scheduled_time,
      attachments,
      selected_prompts: row.selected_prompts ? JSON.parse(row.selected_prompts) : null,
      recording_segments: segments,
    };
  }

  private syncTags(runId: string, tags: string[]): void {
    this.db.prepare("DELETE FROM tags WHERE run_id = ?").run(runId);
    const stmt = this.db.prepare("INSERT INTO tags (run_id, tag) VALUES (?, ?)");
    for (const tag of tags) stmt.run(runId, tag);
  }

  private syncAttachments(runId: string, attachments: string[]): void {
    this.db.prepare("DELETE FROM attachments WHERE run_id = ?").run(runId);
    const stmt = this.db.prepare("INSERT INTO attachments (run_id, filename) VALUES (?, ?)");
    for (const a of attachments) stmt.run(runId, a);
  }

  private syncRecordingSegments(runId: string, segments: string[]): void {
    this.db.prepare("DELETE FROM recording_segments WHERE run_id = ?").run(runId);
    const stmt = this.db.prepare("INSERT INTO recording_segments (run_id, segment_name, sort_order) VALUES (?, ?, ?)");
    for (let i = 0; i < segments.length; i++) stmt.run(runId, segments[i], i);
  }
}

// ---- Row types ----

interface RunRow {
  run_id: string;
  folder_path: string;
  title: string;
  description: string | null;
  date: string;
  started: string;
  ended: string | null;
  status: string;
  source_mode: string;
  duration_minutes: number | null;
  asr_provider: string;
  llm_provider: string;
  scheduled_time: string | null;
  selected_prompts: string | null;
}

interface PromptOutputRow {
  run_id: string;
  prompt_output_id: string;
  status: string;
  filename: string;
  label: string | null;
  builtin: number;
  error: string | null;
  latency_ms: number | null;
  tokens_used: number | null;
  completed_at: string | null;
}

function rowToPromptOutputState(row: PromptOutputRow): PromptOutputState {
  return {
    status: row.status as PromptOutputState["status"],
    filename: row.filename,
    label: row.label ?? undefined,
    builtin: row.builtin === 1 ? true : undefined,
    error: row.error ?? undefined,
    latency_ms: row.latency_ms ?? undefined,
    tokens_used: row.tokens_used ?? undefined,
    completed_at: row.completed_at ?? undefined,
  };
}
