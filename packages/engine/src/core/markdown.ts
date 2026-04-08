import fs from "node:fs";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";

export interface Frontmatter {
  [key: string]: unknown;
}

export function buildMarkdown(frontmatter: Frontmatter, body: string): string {
  const yamlBlock = stringifyYaml(frontmatter).trim();
  return `---\n${yamlBlock}\n---\n\n${body}\n`;
}

export function writeMarkdownFile(
  filePath: string,
  frontmatter: Frontmatter,
  body: string
): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, buildMarkdown(frontmatter, body), "utf-8");
}

export function writeRawFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}
