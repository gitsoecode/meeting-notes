import { useEffect, useRef, useState } from "react";

interface ShortcutRecorderProps {
  value: string;
  onChange: (next: string) => void;
}

/**
 * Converts a `keydown` event into an Electron accelerator string like
 * "CommandOrControl+Shift+M". Returns null if the keystroke isn't a
 * valid binding (e.g. modifier-only, or no modifier at all).
 */
function eventToAccelerator(e: KeyboardEvent): string | null {
  const parts: string[] = [];
  if (e.metaKey) parts.push("CommandOrControl");
  else if (e.ctrlKey) parts.push("CommandOrControl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");

  // Skip events that are pure modifier presses.
  const key = e.key;
  if (
    key === "Control" ||
    key === "Shift" ||
    key === "Alt" ||
    key === "Meta" ||
    key === "Dead"
  ) {
    return null;
  }

  let mainKey = key;
  // Normalize letters to uppercase.
  if (mainKey.length === 1 && /[a-z]/i.test(mainKey)) {
    mainKey = mainKey.toUpperCase();
  } else if (mainKey === " ") {
    mainKey = "Space";
  } else if (mainKey === "ArrowUp") mainKey = "Up";
  else if (mainKey === "ArrowDown") mainKey = "Down";
  else if (mainKey === "ArrowLeft") mainKey = "Left";
  else if (mainKey === "ArrowRight") mainKey = "Right";
  else if (mainKey === "Escape") mainKey = "Esc";

  parts.push(mainKey);

  // Require at least one modifier — bare letters are too easy to trip.
  if (parts.length < 2) return null;
  return parts.join("+");
}

export function ShortcutRecorder({ value, onChange }: ShortcutRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!recording) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const accel = eventToAccelerator(e);
      if (accel) {
        onChange(accel);
        setRecording(false);
        setHint(null);
      } else if (
        e.key !== "Control" &&
        e.key !== "Shift" &&
        e.key !== "Alt" &&
        e.key !== "Meta"
      ) {
        setHint("Need at least one modifier (⌘, ⌃, ⌥, or Shift).");
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [recording, onChange]);

  return (
    <div className="row" style={{ alignItems: "center" }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setRecording((r) => !r);
          setHint(null);
        }}
        className={recording ? "primary" : ""}
        style={{ minWidth: 200, fontFamily: "var(--font-mono)" }}
      >
        {recording ? "Press keys…" : value || "(none)"}
      </button>
      {value && !recording && (
        <button
          type="button"
          onClick={() => onChange("")}
          title="Clear shortcut"
        >
          Clear
        </button>
      )}
      {hint && <span className="muted tone-warning">{hint}</span>}
    </div>
  );
}
