import { useEffect, useRef } from "react";
import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame-dark.css";

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

  onChangeRef.current = onChange;
  onBlurRef.current = onBlur;

  // Mount the editor exactly once. Re-seeding on value change is handled
  // by the second effect.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const crepe = new Crepe({ root, defaultValue: value });
    crepe.on((api) => {
      api.markdownUpdated((_ctx, markdown) => {
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
      void crepe.destroy();
      crepeRef.current = null;
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

    const oldCrepe = crepeRef.current;
    const root = rootRef.current;
    const seedValue = value;

    const recreate = () => {
      const next = new Crepe({ root, defaultValue: seedValue });
      next.on((api) => {
        api.markdownUpdated((_ctx, markdown) => {
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
      void oldCrepe.destroy().then(recreate);
    } else {
      recreate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    crepeRef.current?.setReadonly(readOnly);
  }, [readOnly]);

  return <div ref={rootRef} className={className ?? "markdown-editor"} />;
}
