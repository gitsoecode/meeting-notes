import { useEffect, useRef } from "react";
import { Crepe } from "@milkdown/crepe";
import { cn } from "@/lib/utils";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
}

/**
 * Milkdown Crepe based markdown editor. Renders a WYSIWYG-style markdown
 * surface (slash menu, list continuation, inline formatting) and emits
 * the canonical markdown back via `onChange`. The component is
 * controlled-ish — the parent owns the string, but Crepe maintains its
 * own ProseMirror state, so we only re-seed it when the incoming value
 * is genuinely different from what we last emitted (e.g., switching
 * files), to avoid clobbering the editor on every keystroke.
 */
export function MarkdownEditor({
  value,
  onChange,
  onBlur,
  readOnly = false,
  className,
}: MarkdownEditorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  const lastEmittedRef = useRef<string>(value);
  // Tracks whether a destroy→recreate cycle is pending so a second value
  // change mid-cycle can't spawn a parallel recreate (which caused the
  // Milkdown "context not found" throws we were seeing in the logs).
  const pendingReseedRef = useRef<string | null>(null);
  const unmountedRef = useRef(false);

  onChangeRef.current = onChange;
  onBlurRef.current = onBlur;

  // Mount the editor exactly once. Re-seeding on value change is handled
  // by the second effect.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    unmountedRef.current = false;

    const crepe = new Crepe({ root, defaultValue: value });
    let initialized = false;
    crepe.on((api) => {
      api.markdownUpdated((_ctx, markdown) => {
        // Crepe fires markdownUpdated on creation when it parses and
        // re-serializes the initial markdown. Skip this first emission
        // so the parent's dirty-detection isn't tripped by Crepe's
        // normalization (e.g., whitespace, list marker style).
        if (!initialized) {
          initialized = true;
          lastEmittedRef.current = markdown;
          return;
        }
        lastEmittedRef.current = markdown;
        onChangeRef.current(markdown);
      });
      api.blur(() => {
        onBlurRef.current?.();
      });
    });
    crepe.setReadonly(readOnly);
    crepeRef.current = crepe;
    void crepe.create();

    return () => {
      unmountedRef.current = true;
      const toDestroy = crepeRef.current;
      crepeRef.current = null;
      // Milkdown can throw "context not found" when a ctx.get is in-flight as
      // the editor tears down. That's benign during unmount — swallow it.
      void toDestroy?.destroy().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-seed the editor when the parent swaps in a value we didn't emit
  // ourselves (e.g., loading a different notes.md). Crepe doesn't expose
  // a setMarkdown helper, so we destroy + recreate. This is rare so the
  // cost is acceptable.
  useEffect(() => {
    if (!rootRef.current) return;
    if (value === lastEmittedRef.current) return;

    // If a reseed is already in flight, just record the latest target value
    // and let that cycle pick it up when it finishes destroying.
    if (pendingReseedRef.current !== null) {
      pendingReseedRef.current = value;
      return;
    }

    pendingReseedRef.current = value;

    const oldCrepe = crepeRef.current;
    const root = rootRef.current;

    const recreate = () => {
      const seedValue = pendingReseedRef.current ?? value;
      pendingReseedRef.current = null;
      if (unmountedRef.current) return;
      if (!rootRef.current || rootRef.current !== root) return;

      const next = new Crepe({ root, defaultValue: seedValue });
      let seeded = false;
      next.on((api) => {
        api.markdownUpdated((_ctx, markdown) => {
          if (!seeded) {
            seeded = true;
            lastEmittedRef.current = markdown;
            return;
          }
          lastEmittedRef.current = markdown;
          onChangeRef.current(markdown);
        });
        api.blur(() => {
          onBlurRef.current?.();
        });
      });
      next.setReadonly(readOnly);
      crepeRef.current = next;
      lastEmittedRef.current = seedValue;
      void next.create();
    };

    if (oldCrepe) {
      crepeRef.current = null;
      // Swallow ctx-not-found thrown during teardown; it's benign here.
      void oldCrepe.destroy().catch(() => {}).then(recreate);
    } else {
      recreate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    crepeRef.current?.setReadonly(readOnly);
  }, [readOnly]);

  return <div ref={rootRef} className={cn("markdown-editor", className)} />;
}
