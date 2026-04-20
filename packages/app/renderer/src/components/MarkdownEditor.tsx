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
  /**
   * When true, the unmount cleanup synchronously reads `crepe.getMarkdown()`
   * and forwards any unflushed content through `onChange` before destroying
   * the editor. This rescues the final keystroke batch on fast
   * edit-then-unmount paths (e.g., typing and immediately toggling a view)
   * when the parent is using debounced autosave.
   *
   * Set to `false` (default) when the parent uses `key` to intentionally
   * remount with a new seed — otherwise the cleanup will call `onChange`
   * with the OLD editor's markdown *after* the parent has already set state
   * to the NEW seed, clobbering the new value. Explicit-save surfaces
   * (PromptsEditor) do not need this rescue and should leave it off.
   */
  flushOnUnmount?: boolean;
}

/**
 * Milkdown Crepe based markdown editor.
 *
 * Contract: the parent must mount this component with the **final** content
 * it wants to seed (read from disk first) — we do not try to re-seed a
 * running editor. Changing `value` after the first non-empty mount is a no-op
 * once Crepe has accepted the initial buffer; force a remount via `key` if
 * the seed needs to change (e.g., switching files).
 *
 * The earlier "destroy + recreate on value change" path raced with Crepe's
 * async `create()` under React StrictMode and left edit events tied to a
 * torn-down listener — deletions looked fine in the DOM but never flowed
 * back to `onChange`. See `packages/app/playwright/specs/notes-autosave.spec.ts`.
 */
export function MarkdownEditor({
  value,
  onChange,
  onBlur,
  readOnly = false,
  className,
  flushOnUnmount = false,
}: MarkdownEditorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  // Last markdown Crepe emitted. We forward *every* emission to onChange
  // (including Crepe's initial normalization echo) — there is no
  // user-visible "dirty" state to protect, and swallowing the first event
  // per listener lost real keystrokes when StrictMode / re-seed created
  // multiple listeners.
  const lastEmittedRef = useRef<string>(value);

  onChangeRef.current = onChange;
  onBlurRef.current = onBlur;

  // Mount the editor exactly once. The parent owns remount by changing
  // `key` — this effect intentionally does not depend on `value`.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const crepe = new Crepe({ root, defaultValue: value });
    crepe.on((api) => {
      api.markdownUpdated((_ctx, markdown) => {
        if (markdown === lastEmittedRef.current) return;
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
      const toDestroy = crepeRef.current;
      crepeRef.current = null;
      // Pull the current markdown *synchronously* before starting the async
      // destroy. Crepe batches markdownUpdated on a microtask; a fast
      // edit-then-unmount path can race such that the final keystroke
      // batch never fires markdownUpdated (Crepe swallows pending work
      // during destroy), leaving the parent's buffer stale. Reading here
      // and forwarding to onChange guarantees the final content survives.
      if (flushOnUnmount) {
        try {
          const finalMarkdown = toDestroy?.getMarkdown();
          if (typeof finalMarkdown === "string" && finalMarkdown !== lastEmittedRef.current) {
            lastEmittedRef.current = finalMarkdown;
            onChangeRef.current(finalMarkdown);
          }
        } catch {
          // If Crepe's ctx is already torn down we can't recover the final
          // buffer — nothing to do, fall through to destroy.
        }
      }
      // Milkdown can throw "context not found" when a ctx.get is in-flight as
      // the editor tears down. That's benign during unmount — swallow it.
      void toDestroy?.destroy().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    crepeRef.current?.setReadonly(readOnly);
  }, [readOnly]);

  return <div ref={rootRef} className={cn("markdown-editor", className)} />;
}
