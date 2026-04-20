import type Database from "better-sqlite3";
import type { ChunkInput } from "@gistlist/engine";
import { isVecAvailable } from "../db/sqlite-vec-loader.js";

/**
 * Delete all existing chat chunks (+ their vectors) for a run. Triggers
 * keep `chat_chunks_fts` in sync. The vec table is only touched when the
 * sqlite-vec extension is loaded.
 */
export function clearRunChunks(db: Database.Database, runId: string): void {
  const ids = db
    .prepare("SELECT chunk_id FROM chat_chunks WHERE run_id = ?")
    .all(runId) as Array<{ chunk_id: number }>;

  if (ids.length > 0 && isVecAvailable()) {
    const delVec = db.prepare("DELETE FROM chat_chunks_vec WHERE rowid = ?");
    const tx = db.transaction((rows: Array<{ chunk_id: number }>) => {
      for (const r of rows) delVec.run(BigInt(r.chunk_id));
    });
    tx(ids);
  }

  db.prepare("DELETE FROM chat_chunks WHERE run_id = ?").run(runId);
}

/**
 * Insert chunks + optional vectors for a run. Caller supplies embeddings
 * aligned 1:1 with chunks; vectors are skipped when sqlite-vec isn't
 * available (FTS-only fallback). Returns the assigned chunk ids.
 */
export function insertRunChunks(
  db: Database.Database,
  runId: string,
  chunks: ChunkInput[],
  embeddings: number[][] | null
): number[] {
  if (chunks.length === 0) return [];

  const insertChunk = db.prepare(`
    INSERT INTO chat_chunks (run_id, kind, speaker, start_ms, end_ms, text, seekable)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  // sqlite-vec's vec0 virtual table requires the rowid to be bound as a
  // BigInt — a plain JS `Number` is rejected with "Only integers are
  // allowed for primary key values". Use `chunk_id` as an alias so
  // existing SELECTs keep working.
  const insertVec = isVecAvailable()
    ? db.prepare("INSERT INTO chat_chunks_vec (rowid, embedding) VALUES (?, ?)")
    : null;

  const chunkIds: number[] = [];

  const tx = db.transaction(() => {
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const result = insertChunk.run(
        runId,
        c.kind,
        c.speaker ?? null,
        c.start_ms,
        c.end_ms,
        c.text,
        c.seekable ? 1 : 0
      );
      const idBigInt =
        typeof result.lastInsertRowid === "bigint"
          ? result.lastInsertRowid
          : BigInt(result.lastInsertRowid);
      chunkIds.push(Number(idBigInt));

      if (insertVec && embeddings && embeddings[i]) {
        insertVec.run(
          idBigInt,
          Buffer.from(new Float32Array(embeddings[i]).buffer)
        );
      }
    }
  });
  tx();

  return chunkIds;
}

/** Read the `embedding_model` meta value, or null if never written. */
export function getEmbeddingModelMeta(db: Database.Database): string | null {
  const row = db
    .prepare("SELECT value FROM chat_index_meta WHERE key = 'embedding_model'")
    .get() as { value: string } | undefined;
  return row?.value ?? null;
}

/** Write the `embedding_model` meta value. */
export function setEmbeddingModelMeta(db: Database.Database, model: string): void {
  db.prepare(
    "INSERT INTO chat_index_meta (key, value) VALUES ('embedding_model', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(model);
}

/** Count indexed chunks for a run (0 ⇒ not yet indexed or cleared). */
export function countRunChunks(db: Database.Database, runId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) as n FROM chat_chunks WHERE run_id = ?")
    .get(runId) as { n: number };
  return row.n;
}
