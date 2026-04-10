import { useState } from "react";
import { api } from "../ipc-client";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Spinner } from "./ui/spinner";
import { Textarea } from "./ui/textarea";

interface NewMeetingModalProps {
  onClose: () => void;
  onStarted?: () => void;
}

export function NewMeetingModal({ onClose, onStarted }: NewMeetingModalProps) {
  const [title, setTitle] = useState(() => {
    const d = new Date();
    return `Meeting — ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  });
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
      onStarted?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New meeting</DialogTitle>
          <DialogDescription>
            Start a fresh recording from the tray or shortcut without hunting for the
            home screen first.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="new-meeting-title"
              className="text-sm font-medium text-[var(--text-secondary)]"
            >
              Title
            </label>
            <Input
              id="new-meeting-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onFocus={(e) => e.target.select()}
              disabled={starting}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void onStart();
              }}
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="new-meeting-description"
              className="text-sm font-medium text-[var(--text-secondary)]"
            >
              Description
            </label>
            <Textarea
              id="new-meeting-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              disabled={starting}
              placeholder="What's this meeting about?"
            />
          </div>

          {error ? <div className="text-sm text-[var(--error)]">{error}</div> : null}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={starting}>
            Cancel
          </Button>
          <Button onClick={onStart} disabled={starting}>
            {starting ? (
              <>
                <Spinner className="mr-2 h-3.5 w-3.5" />
                Starting…
              </>
            ) : (
              "Start recording"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
