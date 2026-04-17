import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export interface EditableTitleProps {
  value: string;
  onSave: (v: string) => void;
}

/**
 * Inline editable title. The title text itself is the click target — no
 * separate pencil affordance. Saves on Enter/blur, reverts on Escape.
 */
export function EditableTitle({ value, onSave }: EditableTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { onSave(draft); setEditing(false); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { onSave(draft); setEditing(false); }
            if (e.key === "Escape") { setDraft(value); setEditing(false); }
          }}
          className="text-base md:text-lg font-semibold h-auto py-1"
        />
        <Button variant="ghost" size="sm" onClick={() => { setDraft(value); setEditing(false); }}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label="Edit title"
      title={value}
      className="min-w-0 truncate rounded px-1 -mx-1 text-left text-base font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-secondary)] md:text-lg"
    >
      {value}
    </button>
  );
}
