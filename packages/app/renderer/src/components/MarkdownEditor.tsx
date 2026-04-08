import { useEffect, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
}

/**
 * CodeMirror 6 based markdown editor. Auto-saves happen in the parent
 * on debounced onChange + blur — this component is stateless.
 */
export function MarkdownEditor({
  value,
  onChange,
  onBlur,
  readOnly = false,
  placeholder,
  className,
}: MarkdownEditorProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Wire a blur handler on the underlying contenteditable.
  useEffect(() => {
    if (!onBlur || !wrapperRef.current) return;
    const el = wrapperRef.current;
    const handler = () => onBlur();
    // CodeMirror's content area is `.cm-content`
    const content = el.querySelector(".cm-content");
    if (!content) return;
    content.addEventListener("blur", handler, true);
    return () => content.removeEventListener("blur", handler, true);
  }, [onBlur]);

  return (
    <div ref={wrapperRef} className={className ?? "markdown-editor"}>
      <CodeMirror
        value={value}
        onChange={(v) => onChange(v)}
        theme={oneDark}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
        }}
        extensions={[
          markdown(),
          EditorView.lineWrapping,
        ]}
        readOnly={readOnly}
        placeholder={placeholder}
        height="100%"
        style={{ height: "100%" }}
      />
    </div>
  );
}
