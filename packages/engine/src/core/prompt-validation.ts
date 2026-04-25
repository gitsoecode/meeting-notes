import path from "node:path";

// Reserved run-folder filenames that prompts must NOT overwrite.
// IMPORTANT: do NOT include "summary.md" here — the built-in `summary`
// prompt at packages/engine/src/defaults/prompts/summary.md ships with
// `filename: summary.md` and is the canonical recap output.
export const RESERVED_PROMPT_OUTPUT_FILENAMES: ReadonlySet<string> = new Set([
  "index.md",
  "notes.md",
  "transcript.md",
  "prep.md",
  "run.log",
]);

export function isAllowedPromptOutputFilename(filename: unknown): filename is string {
  if (typeof filename !== "string" || !filename) return false;
  if (path.basename(filename) !== filename) return false;
  if (!filename.endsWith(".md")) return false;
  if (RESERVED_PROMPT_OUTPUT_FILENAMES.has(filename)) return false;
  return true;
}
