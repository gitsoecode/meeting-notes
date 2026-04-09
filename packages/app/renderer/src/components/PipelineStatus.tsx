import { useEffect, useState } from "react";
import type { PipelineProgressEvent } from "../../../shared/ipc";
import { classifyModelClient } from "../constants";

export type SectionState = "pending" | "running" | "complete" | "failed";

export interface SectionStatus {
  id: string;
  label: string;
  state: SectionState;
  latencyMs?: number;
  error?: string;
  /** Wall-clock ms timestamp when this section last entered "running". */
  startedAt?: number;
  /** Model id this section runs against — drives the local-vs-cloud chip. */
  model?: string;
}

export interface PipelineStatusProps {
  sections: SectionStatus[];
  title?: string;
}

export function PipelineStatus({ sections, title = "Pipeline" }: PipelineStatusProps) {
  // Drive a 1 Hz repaint while *any* section is running so the elapsed
  // counters move. The interval is torn down as soon as nothing is
  // running anymore — no wasted work for stale meetings.
  const anyRunning = sections.some((s) => s.state === "running");
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [anyRunning]);

  return (
    <div className="card">
      <div className="card-header">
        <span>{title}</span>
      </div>
      <div className="pipeline-list">
        {sections.length === 0 && (
          <div className="muted">No pipeline runs yet.</div>
        )}
        {sections.map((s) => {
          const elapsedSec =
            s.state === "running" && s.startedAt
              ? Math.floor((Date.now() - s.startedAt) / 1000)
              : null;
          const isLocal = s.model ? classifyModelClient(s.model) === "ollama" : false;
          return (
            <div key={s.id} className="pipeline-row">
              <span>{s.label}</span>
              <span className={`state ${s.state}`} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {s.state === "running" && <span className="spinner" aria-hidden="true" />}
                {s.state}
                {s.state === "running" && elapsedSec != null && (
                  <span className="muted" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {elapsedSec}s
                  </span>
                )}
                {s.state === "running" && isLocal && elapsedSec != null && elapsedSec > 20 && (
                  <span className="muted" style={{ fontSize: 11 }}>
                    Running locally — this can take a few minutes
                  </span>
                )}
                {s.latencyMs != null && s.state === "complete"
                  ? ` · ${(s.latencyMs / 1000).toFixed(1)}s`
                  : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Fold a stream of PipelineProgressEvents into a SectionStatus[] in a
 * useReducer-friendly way. Returned as a standalone helper so multiple
 * views (record + reprocess modal) can share the same logic.
 */
export function applyProgress(
  prev: SectionStatus[],
  event: PipelineProgressEvent
): SectionStatus[] {
  switch (event.type) {
    case "section-start": {
      const startedAt = Date.now();
      const existing = prev.find((s) => s.id === event.sectionId);
      if (existing) {
        return prev.map((s) =>
          s.id === event.sectionId
            ? {
                ...s,
                state: "running" as SectionState,
                startedAt,
                model: event.model,
              }
            : s
        );
      }
      return [
        ...prev,
        {
          id: event.sectionId,
          label: event.label,
          state: "running",
          startedAt,
          model: event.model,
        },
      ];
    }
    case "section-complete":
      return prev.map((s) =>
        s.id === event.sectionId
          ? { ...s, state: "complete" as SectionState, latencyMs: event.latencyMs }
          : s
      );
    case "section-failed":
      return prev.map((s) =>
        s.id === event.sectionId
          ? {
              ...s,
              state: "failed" as SectionState,
              latencyMs: event.latencyMs,
              error: event.error,
            }
          : s
      );
    default:
      return prev;
  }
}
