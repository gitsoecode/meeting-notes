import fs from "node:fs";
import path from "node:path";
import { loadConfig, resolveRunsPath, type AppConfig } from "@gistlist/engine";

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

export interface BulkDeletePartition {
  // Validated, resolved-and-rooted run folder paths — safe to remove from disk.
  validatedFolders: string[];
  // Inputs that failed validation. DB cleanup only — must NEVER be passed to
  // any filesystem mutation. Kept so the caller can still scrub stale rows.
  dbOnlyFolders: string[];
}

// Partitions a list of raw run-folder strings (e.g. from the renderer) into
// "safe to fs.rmSync" vs "DB cleanup only". The bug this guards against is
// pushing the *raw* input into the rmSync list when validation throws — a
// single line that previously allowed arbitrary path removal.
export function partitionRunFoldersForBulkDelete(
  runFolders: readonly string[],
  config: AppConfig = loadConfig()
): BulkDeletePartition {
  const validatedFolders: string[] = [];
  const dbOnlyFolders: string[] = [];
  for (const rf of runFolders) {
    try {
      validatedFolders.push(resolveRunFolderPath(rf, config));
    } catch {
      dbOnlyFolders.push(rf);
    }
  }
  return { validatedFolders, dbOnlyFolders };
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

export function computeRunFolderSize(
  runFolder: string,
  config: AppConfig = loadConfig()
): number {
  const resolvedRunFolder = resolveRunFolderPath(runFolder, config);
  return sumDirectorySize(resolvedRunFolder);
}

function sumDirectorySize(dir: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile()) {
      try {
        total += fs.statSync(full).size;
      } catch {
        // skip unreadable files
      }
    } else if (entry.isDirectory()) {
      total += sumDirectorySize(full);
    }
  }
  return total;
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

export function inferAudioStorage(files: RunFileDescriptor[]) {
  const media = files.filter((file) => file.kind === "media" && file.name.startsWith(`${RUN_AUDIO_DIR}/`));
  const totalBytes = media.reduce((sum, file) => sum + file.size, 0);
  if (media.length === 0) {
    return {
      mode: "none" as const,
      sourceFormat: "none" as const,
      combinedFormat: "none" as const,
      totalBytes,
      usesLossySources: false,
    };
  }

  const sourceExts = new Set<string>();
  let combinedFormat: "ogg" | "wav" | "none" = "none";
  for (const file of media) {
    const base = path.posix.basename(file.name);
    const ext = path.posix.extname(base).slice(1).toLowerCase();
    if (base === "combined.ogg") combinedFormat = "ogg";
    else if (base === "combined.wav" && combinedFormat === "none") combinedFormat = "wav";
    if (/^(mic|system)\.(wav|ogg|flac)$/.test(base)) {
      sourceExts.add(ext);
    }
  }

  const sourceFormat: "ogg" | "flac" | "wav" | "mixed" | "none" =
    sourceExts.size === 0
      ? "none"
      : sourceExts.size === 1
        ? (Array.from(sourceExts)[0] as "ogg" | "flac" | "wav")
        : "mixed";
  const mode: "compact" | "lossless" | "full-fidelity" | "mixed" | "none" =
    sourceFormat === "ogg"
      ? "compact"
      : sourceFormat === "flac"
        ? "lossless"
        : sourceFormat === "wav"
          ? "full-fidelity"
          : sourceFormat === "none"
            ? "none"
            : "mixed";

  return {
    mode,
    sourceFormat,
    combinedFormat,
    totalBytes,
    usesLossySources: sourceFormat === "ogg" || sourceFormat === "mixed",
  };
}
