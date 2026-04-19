import React from "react";
import type { ChatCitationDTO, ChatCitationSource } from "../../../shared/ipc";
import { MarkdownView } from "../components/MarkdownView";
import { SourceChip } from "../components/SourceChip";
import { TimestampPill, msToMmSs } from "../components/TimestampPill";

const MARKER_RE = /\[\[cite:([A-Za-z0-9_-]+):([A-Za-z0-9]+)\]\]/g;

export interface RenderCitationsOptions {
  /** Citations already resolved (title snapshot etc). Keyed lookup by run_id+ref. */
  citations: ChatCitationDTO[];
  onSeek: (runId: string, startMs: number, title: string) => void;
  onOpen: (
    runId: string,
    title: string,
    source: ChatCitationSource,
  ) => void;
}

/**
 * Replace `[[cite:run_id:ref]]` markers in an assistant message with clickable
 * React elements, and render the surrounding text as markdown. Falls back to
 * plain text when no matching citation is persisted (e.g. the run was
 * deleted post hoc).
 */
export function renderCitations(
  text: string,
  opts: RenderCitationsOptions,
): React.ReactNode[] {
  const { citations, onSeek, onOpen } = opts;
  const byKey = new Map<string, ChatCitationDTO>();
  for (const c of citations) {
    const key = c.start_ms != null ? `${c.run_id}:${c.start_ms}` : `${c.run_id}:${c.source}`;
    byKey.set(key, c);
  }

  const out: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  MARKER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  const pushText = (chunk: string) => {
    if (!chunk) return;
    // Render each text segment as markdown so bolds, lists, and paragraph
    // breaks in the assistant's output survive. Use an inline class that
    // flattens block margins to keep citations reading naturally next to
    // surrounding prose.
    out.push(
      <MarkdownView
        key={`md-${key++}`}
        source={chunk}
        className="chat-markdown inline [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
      />,
    );
  };

  while ((match = MARKER_RE.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    pushText(before);
    const runId = match[1];
    const ref = match[2];

    // Prefer the exact cited entry; otherwise fall back to any citation for
    // this run so we can still render something useful.
    const exact =
      byKey.get(`${runId}:${ref}`) ??
      citations.find((c) => c.run_id === runId) ??
      null;

    if (!exact) {
      out.push(
        <span
          key={`cite-missing-${key++}`}
          className="inline-flex items-center rounded-md border border-dashed border-[var(--border-subtle)] bg-transparent px-1.5 py-0.5 text-xs text-[var(--text-tertiary)]"
          title="Meeting no longer available"
        >
          meeting removed
        </span>,
      );
    } else if (exact.start_ms != null && /^\d+$/.test(ref)) {
      const ms = Number(ref);
      const label = `${exact.run_title_snapshot} · ${msToMmSs(ms)}`;
      out.push(
        <TimestampPill
          key={`cite-pill-${key++}`}
          label={label}
          startMs={ms}
          onClick={() => onSeek(exact.run_id, ms, exact.run_title_snapshot)}
        />,
      );
    } else {
      out.push(
        <SourceChip
          key={`cite-chip-${key++}`}
          title={exact.run_title_snapshot}
          source={exact.source}
          onClick={() =>
            onOpen(exact.run_id, exact.run_title_snapshot, exact.source)
          }
        />,
      );
    }
    lastIndex = match.index + match[0].length;
  }
  const tail = text.slice(lastIndex);
  pushText(tail);
  return out;
}

/** Locate a meeting's `runFolder` via IPC. Chat stores `run_id` but routes
 *  use `runFolder` (folder path on disk) — we resolve lazily on click. */
export async function resolveRunFolder(runId: string): Promise<string | null> {
  const all = await window.api.runs.list();
  const row = all.find((r) => r.run_id === runId);
  return row?.folder_path ?? null;
}
