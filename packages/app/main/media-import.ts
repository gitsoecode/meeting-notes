import fs from "node:fs";
import path from "node:path";

export const SUPPORTED_MEDIA_EXTENSIONS = [
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
  ".mkv",
  ".avi",
  ".mp3",
  ".m4a",
  ".wav",
  ".aiff",
  ".flac",
  ".ogg",
] as const;

export interface PickedMediaFile {
  token: string;
  name: string;
}

export function isSupportedMediaFileName(fileName: string): boolean {
  return SUPPORTED_MEDIA_EXTENSIONS.includes(
    path.extname(fileName).toLowerCase() as (typeof SUPPORTED_MEDIA_EXTENSIONS)[number]
  );
}

export function assertImportMediaPath(mediaPath: string): string {
  if (!mediaPath || !mediaPath.trim()) {
    throw new Error("No media file was provided.");
  }

  const resolvedPath = path.resolve(mediaPath);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolvedPath);
  } catch {
    throw new Error("The selected media file could not be found.");
  }

  if (!stat.isFile()) {
    throw new Error("Only files can be imported as meetings.");
  }

  if (!isSupportedMediaFileName(resolvedPath)) {
    throw new Error(
      "Unsupported media type. Import a common audio or video recording such as mp4, mov, webm, mp3, m4a, wav, or flac."
    );
  }

  return resolvedPath;
}
