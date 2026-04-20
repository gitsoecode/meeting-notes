import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  chunkMarkdown,
  chunkTranscript,
  parseTranscriptMarkdown,
  createAppLogger,
  type ChunkInput,
} from "@gistlist/engine";
import type { TranscriptResult } from "@gistlist/engine/adapters/asr/provider";
import { getDb } from "../db/connection.js";
import { isVecAvailable } from "../db/sqlite-vec-loader.js";
import { clearRunChunks, insertRunChunks } from "./store.js";

const appLogger = createAppLogger(false);

export interface IndexRunOptions {
  /**
   * When provided, use this transcript result directly (millisecond precision
   * available). Otherwise we parse `transcript.md` from disk. The processRun
   * hook point passes the result; backfill doesn't and falls back to disk.
   */
  transcriptResult?: TranscriptResult;
  /** Optional Ollama embedder. If absent, we skip vector insert (FTS-only). */
  embedder?: (inputs: string[]) => Promise<number[][]>;
  /** Abort the in-flight indexing. */
  signal?: AbortSignal;
}

/**
 * Build a set of chunks from a run's on-disk artifacts (transcript.md,
 * summary.md, notes.md, prep.md). Returns empty array if nothing indexable.
 */
export function buildChunksFromRunFolder(
  runFolder: string,
  opts: { transcriptResult?: TranscriptResult } = {}
): ChunkInput[] {
  const chunks: ChunkInput[] = [];

  const combinedPath = path.join(runFolder, "audio", "combined.wav");
  const combinedAvailable = fs.existsSync(combinedPath);

  // Transcript — prefer the in-memory result (ms-precise) when present.
  if (opts.transcriptResult) {
    chunks.push(
      ...chunkTranscript(opts.transcriptResult.segments, {
        combinedAudioAvailable: combinedAvailable,
      })
    );
  } else {
    const transcriptPath = path.join(runFolder, "transcript.md");
    if (fs.existsSync(transcriptPath)) {
      const md = stripFrontmatter(fs.readFileSync(transcriptPath, "utf-8"));
      const segments = parseTranscriptMarkdown(md);
      chunks.push(
        ...chunkTranscript(segments, { combinedAudioAvailable: combinedAvailable })
      );
    }
  }

  // Summary / prep / notes — chunked without timestamps.
  for (const { file, kind } of [
    { file: "summary.md", kind: "summary" as const },
    { file: "prep.md", kind: "prep" as const },
    { file: "notes.md", kind: "notes" as const },
  ]) {
    const p = path.join(runFolder, file);
    if (!fs.existsSync(p)) continue;
    const md = stripFrontmatter(fs.readFileSync(p, "utf-8"));
    if (!md.trim()) continue;
    chunks.push(...chunkMarkdown(md, { kind }));
  }

  return chunks;
}

function stripFrontmatter(md: string): string {
  if (!md.startsWith("---")) return md;
  const end = md.indexOf("\n---", 3);
  if (end === -1) return md;
  return md.slice(end + 4).replace(/^\s*\n/, "");
}

/**
 * Index (or re-index) a run. Parses artifacts, chunks, optionally embeds, and
 * writes to sqlite. Safe to call after processRun, after reprocess, after
 * prep update, and during backfill. Swallows all errors — indexing failure
 * must not break the surrounding flow.
 */
export async function indexRun(
  runFolder: string,
  opts: IndexRunOptions = {}
): Promise<{ chunksIndexed: number; embedded: boolean; skipped?: string }> {
  const db = getDb();
  const runId = lookupRunIdByFolder(db, runFolder);
  if (!runId) {
    return { chunksIndexed: 0, embedded: false, skipped: "run-not-found" };
  }

  try {
    const chunks = buildChunksFromRunFolder(runFolder, {
      transcriptResult: opts.transcriptResult,
    });

    // Always clear first so a run that shrinks (e.g. user deleted notes)
    // doesn't leave orphan rows. This mirrors the reindex-on-write semantics.
    clearRunChunks(db, runId);

    if (chunks.length === 0) {
      return { chunksIndexed: 0, embedded: false };
    }

    let embeddings: number[][] | null = null;
    if (opts.embedder && isVecAvailable()) {
      try {
        embeddings = await opts.embedder(chunks.map((c) => c.text));
      } catch (err) {
        appLogger.warn("chat-index embed failed — continuing without vectors", {
          detail: err instanceof Error ? err.message : String(err),
          runFolder,
        });
        embeddings = null;
      }
    }

    insertRunChunks(db, runId, chunks, embeddings);

    return {
      chunksIndexed: chunks.length,
      embedded: embeddings !== null,
    };
  } catch (err) {
    appLogger.warn("indexRun failed", {
      detail: err instanceof Error ? err.message : String(err),
      runFolder,
    });
    return { chunksIndexed: 0, embedded: false, skipped: "error" };
  }
}

export function lookupRunIdByFolder(
  db: Database.Database,
  runFolder: string
): string | null {
  const row = db
    .prepare("SELECT run_id FROM runs WHERE folder_path = ?")
    .get(runFolder) as { run_id: string } | undefined;
  return row?.run_id ?? null;
}
