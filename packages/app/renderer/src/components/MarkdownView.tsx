import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import { stripFrontmatter } from "../lib/utils";

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: false,
  typographer: true,
});

const HTML_CACHE_LIMIT = 50;
const htmlCache = new Map<string, string>();

function renderCached(source: string): string {
  const cached = htmlCache.get(source);
  if (cached !== undefined) return cached;
  const rendered = md.render(stripFrontmatter(source));
  const sanitized = DOMPurify.sanitize(rendered, {
    ADD_ATTR: ["data-wikilink"],
  });
  if (htmlCache.size >= HTML_CACHE_LIMIT) {
    const oldestKey = htmlCache.keys().next().value;
    if (oldestKey !== undefined) htmlCache.delete(oldestKey);
  }
  htmlCache.set(source, sanitized);
  return sanitized;
}

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

export function MarkdownView({ source, className, onWikilinkClick }: MarkdownViewProps) {
  const html = renderCached(source || "");

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
