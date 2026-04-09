import { useState } from "react";
import { api } from "../ipc-client";
import type { RunDetail } from "../../../shared/ipc";

interface OverviewPanelProps {
  detail: RunDetail;
  runFolder: string;
  onUpdated: () => void;
}

interface ManifestShape {
  description?: string | null;
  participants?: string[];
  tags?: string[];
  source_mode?: string;
  asr_provider?: string;
  llm_provider?: string;
  sections?: Record<
    string,
    {
      status?: string;
      label?: string;
      filename?: string;
    }
  >;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function OverviewPanel({ detail, runFolder, onUpdated }: OverviewPanelProps) {
  const manifest = (detail.manifest ?? {}) as ManifestShape;

  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState(
    detail.description ?? manifest.description ?? ""
  );
  const [savingDescription, setSavingDescription] = useState(false);

  const description = detail.description ?? manifest.description ?? "";

  const onSaveDescription = async () => {
    setSavingDescription(true);
    try {
      await api.runs.updateMeta({
        runFolder,
        description: descriptionDraft.trim() || null,
      });
      setEditingDescription(false);
      onUpdated();
    } finally {
      setSavingDescription(false);
    }
  };

  const startedDate = new Date(detail.started || detail.date);
  const endedDate = detail.ended ? new Date(detail.ended) : null;

  const participants = manifest.participants ?? [];
  const tags = detail.tags ?? manifest.tags ?? [];
  const sections = manifest.sections ?? {};
  const sectionEntries = Object.entries(sections);

  return (
    <div className="overview-panel">
      <div className="overview-section">
        <div className="overview-row">
          <div className="overview-label">Status</div>
          <div className="overview-value">
            <span className={`status-pill ${detail.status}`}>{detail.status}</span>
            {manifest.source_mode && (
              <span className="muted" style={{ marginLeft: 8 }}>
                · {manifest.source_mode}
              </span>
            )}
          </div>
        </div>

        <div className="overview-row">
          <div className="overview-label">Started</div>
          <div className="overview-value">{startedDate.toLocaleString()}</div>
        </div>

        {endedDate && (
          <div className="overview-row">
            <div className="overview-label">Ended</div>
            <div className="overview-value">{endedDate.toLocaleString()}</div>
          </div>
        )}

        <div className="overview-row">
          <div className="overview-label">Duration</div>
          <div className="overview-value">
            {detail.duration_minutes != null
              ? `${detail.duration_minutes.toFixed(1)} min`
              : "—"}
          </div>
        </div>
      </div>

      <div className="overview-section">
        <div className="overview-row" style={{ alignItems: "flex-start" }}>
          <div className="overview-label">Description</div>
          <div className="overview-value" style={{ flex: 1 }}>
            {editingDescription ? (
              <div>
                <textarea
                  value={descriptionDraft}
                  onChange={(e) => setDescriptionDraft(e.target.value)}
                  rows={3}
                  style={{ width: "100%" }}
                  disabled={savingDescription}
                  autoFocus
                />
                <div className="row" style={{ marginTop: 6 }}>
                  <button
                    className="primary"
                    onClick={onSaveDescription}
                    disabled={savingDescription}
                  >
                    {savingDescription ? "Saving…" : "Save"}
                  </button>
                  <button
                    onClick={() => {
                      setEditingDescription(false);
                      setDescriptionDraft(description);
                    }}
                    disabled={savingDescription}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                className="overview-description"
                onClick={() => setEditingDescription(true)}
                title="Click to edit"
              >
                {description || (
                  <span className="muted">Click to add a description…</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {(participants.length > 0 || tags.length > 0) && (
        <div className="overview-section">
          {participants.length > 0 && (
            <div className="overview-row">
              <div className="overview-label">Participants</div>
              <div className="overview-value chip-row">
                {participants.map((p) => (
                  <span key={p} className="chip">
                    {p}
                  </span>
                ))}
              </div>
            </div>
          )}
          {tags.length > 0 && (
            <div className="overview-row">
              <div className="overview-label">Tags</div>
              <div className="overview-value chip-row">
                {tags.map((t) => (
                  <span key={t} className="chip">
                    #{t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {sectionEntries.length > 0 && (
        <div className="overview-section">
          <div className="overview-section-title">Sections</div>
          <ul className="overview-sections-list">
            {sectionEntries.map(([id, sec]) => (
              <li key={id}>
                <span className={`status-pill ${sec.status ?? "pending"}`}>
                  {sec.status ?? "pending"}
                </span>
                <span style={{ marginLeft: 8 }}>{sec.label ?? id}</span>
                {sec.filename && (
                  <span className="muted" style={{ marginLeft: 8 }}>
                    {sec.filename}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {detail.files.length > 0 && (
        <div className="overview-section">
          <div className="overview-section-title">Files</div>
          <ul className="overview-files-list">
            {detail.files.map((f) => (
              <li key={f.path}>
                <span>{f.name}</span>
                <span className="muted">{fmtBytes(f.size)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
