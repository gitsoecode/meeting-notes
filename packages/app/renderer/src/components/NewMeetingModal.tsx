import { useState } from "react";
import { api } from "../ipc-client";

interface NewMeetingModalProps {
  onClose: () => void;
  onStarted?: (runFolder: string) => void;
}

/**
 * Quick-start modal for kicking off a new recording from anywhere in
 * the app — used by the persistent titlebar button and the global
 * shortcut. The full Home start card uses inline fields instead of
 * this modal.
 */
export function NewMeetingModal({ onClose, onStarted }: NewMeetingModalProps) {
  const [title, setTitle] = useState("Untitled Meeting");
  const [description, setDescription] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onStart = async () => {
    setStarting(true);
    setError(null);
    try {
      const result = await api.recording.start({
        title: title.trim() || "Untitled Meeting",
        description: description.trim() || null,
      });
      onStarted?.(result.run_folder);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New meeting</h2>
        <label>Title</label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onStart();
          }}
        />
        <label style={{ marginTop: 12 }}>Description (optional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="What's this meeting about?"
        />
        {error && (
          <div className="muted" style={{ color: "var(--danger)", marginTop: 8 }}>
            {error}
          </div>
        )}
        <div className="actions">
          <button onClick={onClose} disabled={starting}>
            Cancel
          </button>
          <button className="primary" onClick={onStart} disabled={starting}>
            {starting ? "Starting…" : "Start recording"}
          </button>
        </div>
      </div>
    </div>
  );
}
