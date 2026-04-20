import path from "node:path";
import {
  manifestToFrontmatter,
  buildIndexBody,
  writeMarkdownFile,
  type RunManifest,
} from "@gistlist/engine";

/**
 * Regenerate index.md as a write-only side effect after DB mutations.
 * This keeps the run folder browsable in Obsidian or any markdown viewer.
 */
export function regenerateIndexMd(folderPath: string, manifest: RunManifest): void {
  try {
    writeMarkdownFile(
      path.join(folderPath, "index.md"),
      manifestToFrontmatter(manifest),
      buildIndexBody(manifest)
    );
  } catch {
    // Best effort — DB is the source of truth. If the folder is gone
    // (e.g. just deleted), we silently skip.
  }
}
