import fs from "node:fs";
import path from "node:path";
import type { RunStore } from "./run-store.js";
import {
  loadRunManifest,
  updateRunStatus,
  updatePromptOutput as updatePromptOutputFn,
  type RunManifest,
  type RunStatus,
  type PromptOutputState,
} from "./run.js";
import { writeMarkdownFile } from "./markdown.js";
import { manifestToFrontmatter, buildIndexBody } from "./run.js";

/**
 * Walks a runs root directory to find all run folders (directories
 * containing an index.md file).
 */
export function walkRunFolders(runsRoot: string): string[] {
  if (!fs.existsSync(runsRoot)) return [];
  const folders: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      const indexMd = path.join(full, "index.md");
      if (fs.existsSync(indexMd)) {
        folders.push(full);
      } else {
        walk(full);
      }
    }
  };
  walk(runsRoot);
  return folders;
}

/**
 * RunStore backed by the filesystem (YAML frontmatter in index.md).
 * Used by the CLI and as a fallback/seed source.
 */
export class FilesystemRunStore implements RunStore {
  private runsRoot: string;

  constructor(runsRoot: string) {
    this.runsRoot = runsRoot;
  }

  loadManifest(folderPath: string): RunManifest {
    return loadRunManifest(folderPath);
  }

  updateStatus(folderPath: string, status: RunStatus, updates?: Partial<RunManifest>): RunManifest {
    return updateRunStatus(folderPath, status, updates);
  }

  updatePromptOutput(folderPath: string, promptOutputId: string, state: PromptOutputState): void {
    updatePromptOutputFn(folderPath, promptOutputId, state);
  }

  insertRun(manifest: RunManifest, folderPath: string): void {
    writeMarkdownFile(
      path.join(folderPath, "index.md"),
      manifestToFrontmatter(manifest),
      buildIndexBody(manifest)
    );
  }

  deleteRun(folderPath: string): void {
    fs.rmSync(folderPath, { recursive: true, force: true });
  }

  deleteRuns(folderPaths: string[]): void {
    for (const fp of folderPaths) {
      this.deleteRun(fp);
    }
  }

  listRuns(): Array<{ manifest: RunManifest; folderPath: string }> {
    const folders = walkRunFolders(this.runsRoot);
    const results: Array<{ manifest: RunManifest; folderPath: string }> = [];
    for (const folder of folders) {
      try {
        results.push({ manifest: loadRunManifest(folder), folderPath: folder });
      } catch {
        // Skip unreadable runs.
      }
    }
    return results;
  }
}
