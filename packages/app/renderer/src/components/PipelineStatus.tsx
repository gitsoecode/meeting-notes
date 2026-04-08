import type { PipelineProgressEvent } from "../../../shared/ipc";

export type SectionState = "pending" | "running" | "complete" | "failed";

export interface SectionStatus {
  id: string;
  label: string;
  state: SectionState;
  latencyMs?: number;
  error?: string;
}

export interface PipelineStatusProps {
  sections: SectionStatus[];
  title?: string;
}

export function PipelineStatus({ sections, title = "Pipeline" }: PipelineStatusProps) {
  return (
    <div className="card">
      <div className="card-header">
        <span>{title}</span>
      </div>
      <div className="pipeline-list">
        {sections.length === 0 && (
          <div className="muted">No pipeline runs yet.</div>
        )}
        {sections.map((s) => (
          <div key={s.id} className="pipeline-row">
            <span>{s.label}</span>
            <span className={`state ${s.state}`}>
              {s.state}
              {s.latencyMs != null && s.state === "complete"
                ? ` · ${(s.latencyMs / 1000).toFixed(1)}s`
                : ""}
            </span>
          </div>
        ))}
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
      const existing = prev.find((s) => s.id === event.sectionId);
      if (existing) {
        return prev.map((s) =>
          s.id === event.sectionId
            ? { ...s, state: "running" as SectionState }
            : s
        );
      }
      return [
        ...prev,
        {
          id: event.sectionId,
          label: event.label,
          state: "running",
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
