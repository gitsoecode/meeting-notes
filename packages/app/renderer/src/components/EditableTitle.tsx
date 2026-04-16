import { useEffect, useRef, useState } from "react";
import { Pencil, X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export interface EditableTitleProps {
  value: string;
  onSave: (v: string) => void;
}

/**
 * Inline editable title. Renders a span + pencil affordance by default; clicking
 * either flips into an `<Input>` that saves on Enter/blur and reverts on Escape.
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
          className="text-2xl font-semibold h-auto py-1"
        />
        <Button variant="ghost" size="sm" onClick={() => { setDraft(value); setEditing(false); }}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 group">
      <span className="text-2xl font-semibold text-[var(--text-primary)]">{value}</span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label="Edit title"
        className="rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--bg-secondary)] pointer-events-none group-hover:pointer-events-auto"
      >
        <Pencil className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
      </button>
    </div>
  );
}
