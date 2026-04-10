import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);

export interface AudioInfo {
  durationMs: number;
  sampleRate: number;
  channels: number;
  format: string;
}

export async function mediaHasAudioStream(mediaPath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet",
      "-select_streams", "a:0",
      "-show_entries", "stream=index",
      "-of", "csv=p=0",
      mediaPath,
    ]);
    return stdout.trim().length > 0;
  } catch {
    throw new Error(
      "ffprobe not found. Install ffmpeg:\n  brew install ffmpeg"
    );
  }
}

export async function getAudioInfo(audioPath: string): Promise<AudioInfo> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      audioPath,
    ]);

    const data = JSON.parse(stdout);
    const stream = data.streams?.[0] ?? {};
    const format = data.format ?? {};

    return {
      durationMs: Math.round(parseFloat(format.duration ?? "0") * 1000),
      sampleRate: parseInt(stream.sample_rate ?? "0", 10),
      channels: parseInt(stream.channels ?? "0", 10),
      format: format.format_name ?? "unknown",
    };
  } catch {
    throw new Error(
      "ffprobe not found. Install ffmpeg:\n  brew install ffmpeg"
    );
  }
}

/**
 * Output format for ASR normalization.
 *
 * - `wav16`: 16 kHz mono 16-bit PCM WAV. Default. Largest (~1.92 MB/min) but
 *   lossless and accepted by every ASR provider. Use for local providers
 *   (Parakeet, whisper-local) where there's no upload cost.
 *
 * - `opus32k`: 16 kHz mono 32 kbps Opus in an Ogg container (~0.24 MB/min —
 *   8x smaller than wav16). Use for OpenAI Whisper, which enforces a 25 MB
 *   per-file upload limit. With wav16 the limit caps you around 13 minutes
 *   per channel; with opus32k you get ~100 minutes per channel. Opus at
 *   32 kbps mono is well above transparent-for-speech quality — whisper
 *   shows no measurable WER difference vs. lossless at this bitrate.
 */
export type AsrAudioFormat = "wav16" | "opus32k";

/**
 * Returns the file extension (including the leading dot) for a given ASR
 * audio format. Callers build the normalized output path with this so the
 * extension always matches the encoded format.
 */
export function asrAudioExtension(format: AsrAudioFormat): string {
  return format === "opus32k" ? ".ogg" : ".wav";
}

export async function normalizeAudio(
  inputPath: string,
  outputPath: string,
  format: AsrAudioFormat = "wav16"
): Promise<void> {
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });

  // Common args: 16 kHz mono. Whisper and Parakeet both operate at 16 kHz
  // internally; anything higher gets downsampled on their side anyway.
  const commonArgs = ["-i", inputPath, "-ar", "16000", "-ac", "1"];

  const formatArgs =
    format === "opus32k"
      ? ["-c:a", "libopus", "-b:a", "32k", "-application", "voip"]
      : ["-c:a", "pcm_s16le"];

  try {
    await execFileAsync("ffmpeg", [
      ...commonArgs,
      ...formatArgs,
      "-y", // overwrite
      outputPath,
    ]);
  } catch {
    throw new Error(
      "ffmpeg not found or conversion failed. Install ffmpeg:\n  brew install ffmpeg"
    );
  }
}
