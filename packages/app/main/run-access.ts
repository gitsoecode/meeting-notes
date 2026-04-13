import fs from "node:fs";
import path from "node:path";
import { loadConfig, resolveRunsPath, type AppConfig } from "@meeting-notes/engine";

export const RUN_INDEX_FILE = "index.md";
export const RUN_NOTES_FILE = "notes.md";
export const RUN_TRANSCRIPT_FILE = "transcript.md";
export const RUN_LOG_FILE = "run.log";
export const RUN_AUDIO_DIR = "audio";
export const RUN_PREP_FILE = "prep.md";
export const RUN_ATTACHMENTS_DIR = "attachments";

export type RunFileKind = "document" | "log" | "media" | "attachment";

export interface RunFileDescriptor {
  name: string;
  size: number;
  kind: RunFileKind;
}

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

export function isAllowedRunMediaName(fileName: string): boolean {
  if (!fileName) return false;
  const normalized = path.posix.normalize(fileName);
  if (normalized !== fileName) return false;
  const parts = normalized.split("/");
  // Allow audio/<file> (flat) or audio/<segment>/<file> (segmented recordings)
  if (parts.length < 2 || parts.length > 3 || parts[0] !== RUN_AUDIO_DIR) return false;
  if (parts.length === 3) {
    const segmentName = parts[1];
    if (!segmentName || segmentName === ".." || segmentName === "." || path.posix.basename(segmentName) !== segmentName) return false;
  }
  const baseName = parts[parts.length - 1];
  if (!baseName || path.posix.basename(baseName) !== baseName) return false;
  if (baseName.startsWith("normalized-")) return false;
  return true;
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

export function resolveRunMediaPath(
  runFolder: string,
  fileName: string,
  config: AppConfig = loadConfig()
): string {
  if (!isAllowedRunMediaName(fileName)) {
    throw new Error("Run media name is invalid.");
  }
  const resolvedRunFolder = resolveRunFolderPath(runFolder, config);
  const mediaName = fileName.slice(`${RUN_AUDIO_DIR}/`.length);
  return assertPathInsideRoot(
    resolvedRunFolder,
    path.join(resolvedRunFolder, RUN_AUDIO_DIR, mediaName),
    "Run media"
  );
}

export function isAllowedAttachmentName(fileName: string): boolean {
  if (!fileName || path.basename(fileName) !== fileName) return false;
  if (fileName.startsWith(".")) return false;
  return true;
}

export function resolveRunAttachmentPath(
  runFolder: string,
  fileName: string,
  config: AppConfig = loadConfig()
): string {
  if (!isAllowedAttachmentName(fileName)) {
    throw new Error("Attachment name is invalid.");
  }
  const resolvedRunFolder = resolveRunFolderPath(runFolder, config);
  return assertPathInsideRoot(
    resolvedRunFolder,
    path.join(resolvedRunFolder, RUN_ATTACHMENTS_DIR, fileName),
    "Run attachment"
  );
}

export function listRunFiles(
  runFolder: string,
  config: AppConfig = loadConfig()
): RunFileDescriptor[] {
  const resolvedRunFolder = resolveRunFolderPath(runFolder, config);
  const files: RunFileDescriptor[] = [];

  for (const entry of fs.readdirSync(resolvedRunFolder, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const kind =
      entry.name === RUN_LOG_FILE ? "log" : entry.name.endsWith(".md") ? "document" : null;
    if (!kind) continue;
    const stat = fs.statSync(path.join(resolvedRunFolder, entry.name));
    files.push({ name: entry.name, size: stat.size, kind });
  }

  const audioDir = path.join(resolvedRunFolder, RUN_AUDIO_DIR);
  if (fs.existsSync(audioDir)) {
    for (const entry of fs.readdirSync(audioDir, { withFileTypes: true })) {
      if (entry.isFile()) {
        if (entry.name.startsWith("normalized-")) continue;
        const stat = fs.statSync(path.join(audioDir, entry.name));
        files.push({
          name: path.posix.join(RUN_AUDIO_DIR, entry.name),
          size: stat.size,
          kind: "media",
        });
      } else if (entry.isDirectory()) {
        // Timestamped segment subdirectories
        const segDir = path.join(audioDir, entry.name);
        for (const segEntry of fs.readdirSync(segDir, { withFileTypes: true })) {
          if (!segEntry.isFile() || segEntry.name.startsWith("normalized-")) continue;
          const stat = fs.statSync(path.join(segDir, segEntry.name));
          files.push({
            name: path.posix.join(RUN_AUDIO_DIR, entry.name, segEntry.name),
            size: stat.size,
            kind: "media",
          });
        }
      }
    }
  }

  const attachDir = path.join(resolvedRunFolder, RUN_ATTACHMENTS_DIR);
  if (fs.existsSync(attachDir)) {
    for (const entry of fs.readdirSync(attachDir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith(".")) continue;
      const stat = fs.statSync(path.join(attachDir, entry.name));
      files.push({
        name: path.posix.join(RUN_ATTACHMENTS_DIR, entry.name),
        size: stat.size,
        kind: "attachment",
      });
    }
  }

  files.sort((a, b) => {
    const order = { document: 0, log: 1, media: 2, attachment: 3 } as const;
    if (order[a.kind] !== order[b.kind]) return order[a.kind] - order[b.kind];
    return a.name.localeCompare(b.name);
  });

  return files;
}
