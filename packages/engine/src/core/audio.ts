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

export async function normalizeAudio(
  inputPath: string,
  outputPath: string
): Promise<void> {
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });

  try {
    await execFileAsync("ffmpeg", [
      "-i", inputPath,
      "-ar", "16000",       // 16kHz sample rate (standard for ASR)
      "-ac", "1",            // mono
      "-c:a", "pcm_s16le",  // 16-bit PCM WAV
      "-y",                  // overwrite
      outputPath,
    ]);
  } catch {
    throw new Error(
      "ffmpeg not found or conversion failed. Install ffmpeg:\n  brew install ffmpeg"
    );
  }
}
