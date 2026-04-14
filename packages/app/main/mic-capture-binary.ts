import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the bundled `mic-capture` helper.
 *
 * The helper is a small Swift binary that captures microphone audio via
 * AVAudioEngine / CoreAudio — replacing ffmpeg's AVFoundation demuxer,
 * which drops ~10–12 % of samples on USB mics under macOS 14+. Source:
 * `packages/app/native/mic-capture.swift`; build:
 * `packages/app/scripts/build-mic-capture.mjs` (runs at `npm run build`).
 *
 * Resolution order:
 *   1. `MEETING_NOTES_MIC_CAPTURE_BINARY` env var (tests / CI overrides)
 *   2. Packaged: `process.resourcesPath/bin/mic-capture` (electron-builder
 *      extraResources entry).
 *   3. Dev tree: `<repo>/packages/app/resources/bin/mic-capture` (the
 *      build script's output, used by `npm run dev`).
 *
 * Returns `undefined` when nothing is found — the engine then falls back
 * to ffmpeg AVFoundation with the drift-correction safety net. Users
 * should never hit the fallback in a packaged build.
 */
export function resolveMicCaptureBinary(): string | undefined {
  const candidates: string[] = [];

  const envOverride = process.env.MEETING_NOTES_MIC_CAPTURE_BINARY?.trim();
  if (envOverride) candidates.push(envOverride);

  // Packaged: process.resourcesPath = <App>.app/Contents/Resources
  try {
    if (typeof process.resourcesPath === "string" && process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, "bin", "mic-capture"));
    }
  } catch {
    // ignore
  }

  // Dev tree relative to compiled `dist/main` layout
  // (packages/app/dist/main → packages/app/resources/bin).
  try {
    candidates.push(
      path.resolve(currentDir, "..", "..", "resources", "bin", "mic-capture")
    );
  } catch {
    // ignore
  }

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return undefined;
}
