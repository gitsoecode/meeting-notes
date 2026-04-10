import { useMemo } from "react";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: false,
  typographer: true,
});

// Resolve [[wikilink]] syntax to plain text for now. Intra-app navigation
// uses a callback rather than href routing so we don't fight markdown-it's
// tokenizer here — clicks are handled by a parent onClick with a data attr.
md.core.ruler.after("inline", "wikilinks", (state) => {
  for (const block of state.tokens) {
    if (block.type !== "inline" || !block.children) continue;
    for (const token of block.children) {
      if (token.type !== "text") continue;
      const text = token.content;
      if (!text.includes("[[")) continue;
      token.content = text.replace(
        /\[\[([^\]]+)\]\]/g,
        (_, name: string) => `<a data-wikilink="${name}" href="#">${name}</a>`
      );
      // Force text token to be treated as inline HTML on render by changing
      // its type. markdown-it needs `html_inline` with content set.
      token.type = "html_inline";
    }
  }
});

export interface MarkdownViewProps {
  source: string;
  className?: string;
  onWikilinkClick?: (name: string) => void;
}

function stripFrontmatter(source: string): string {
  if (!source.startsWith("---\n")) return source;
  const end = source.indexOf("\n---\n", 4);
  if (end === -1) return source;
  return source.slice(end + 5);
}

export function MarkdownView({ source, className, onWikilinkClick }: MarkdownViewProps) {
  const html = useMemo(() => {
    const rendered = md.render(stripFrontmatter(source || ""));
    return DOMPurify.sanitize(rendered, {
      ADD_ATTR: ["data-wikilink"],
    });
  }, [source]);

  return (
    <div
      className={`markdown-view ${className ?? ""}`}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        const link = target.closest("[data-wikilink]") as HTMLElement | null;
        if (link) {
          e.preventDefault();
          const name = link.getAttribute("data-wikilink");
          if (name && onWikilinkClick) onWikilinkClick(name);
        }
      }}
    />
  );
}
