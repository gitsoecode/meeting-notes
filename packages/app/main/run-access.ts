import fs from "node:fs";
import path from "node:path";
import { loadConfig, resolveRunsPath, type AppConfig } from "@meeting-notes/engine";

export const RUN_INDEX_FILE = "index.md";
export const RUN_NOTES_FILE = "notes.md";
export const RUN_TRANSCRIPT_FILE = "transcript.md";
export const RUN_LOG_FILE = "run.log";

export function assertPathInsideRoot(rootPath: string, targetPath: string, label: string): string {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} is outside the allowed directory.`);
  }
  return resolvedTarget;
}

export function isAllowedRunDocumentName(fileName: string): boolean {
  if (!fileName || path.basename(fileName) !== fileName) {
    return false;
  }
  return fileName === RUN_LOG_FILE || fileName.endsWith(".md");
}

export function resolveRunFolderPath(
  runFolder: string,
  config: AppConfig = loadConfig()
): string {
  const runsRoot = resolveRunsPath(config);
  const resolvedRunFolder = assertPathInsideRoot(runsRoot, runFolder, "Run folder");
  const indexPath = path.join(resolvedRunFolder, RUN_INDEX_FILE);
  if (!fs.existsSync(indexPath)) {
    throw new Error("Run folder is invalid or no longer exists.");
  }
  return resolvedRunFolder;
}

export function resolveRunDocumentPath(
  runFolder: string,
  fileName: string,
  config: AppConfig = loadConfig()
): string {
  if (!isAllowedRunDocumentName(fileName)) {
    throw new Error("Run document name is invalid.");
  }
  const resolvedRunFolder = resolveRunFolderPath(runFolder, config);
  return assertPathInsideRoot(
    resolvedRunFolder,
    path.join(resolvedRunFolder, fileName),
    "Run document"
  );
}
