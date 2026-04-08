import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import type { AsrProvider, TranscriptResult, TranscriptSegment } from "./provider.js";

const execFileAsync = promisify(execFile);

export class WhisperLocalProvider implements AsrProvider {
  private binaryPath: string;
  private modelPath: string;

  constructor(opts?: { binaryPath?: string; modelPath?: string }) {
    this.binaryPath = opts?.binaryPath ?? "whisper-cli";
    this.modelPath = opts?.modelPath ?? "";
  }

  async transcribe(
    audioPath: string,
    speaker: "me" | "others" | "unknown" = "unknown"
  ): Promise<TranscriptResult> {
    const start = Date.now();

    // whisper.cpp outputs JSON with --output-json flag
    const outputDir = path.dirname(audioPath);
    const baseName = path.basename(audioPath, path.extname(audioPath));

    const args = [
      "-f", audioPath,
      "-oj",              // output JSON
      "-of", path.join(outputDir, baseName),
    ];

    if (this.modelPath) {
      args.push("-m", this.modelPath);
    }

    try {
      await execFileAsync(this.binaryPath, args, { timeout: 600_000 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `whisper.cpp failed: ${msg}\n\n` +
        "Make sure whisper.cpp is installed. On macOS:\n" +
        "  brew install whisper-cpp\n" +
        "  # Or build from source: https://github.com/ggerganov/whisper.cpp"
      );
    }

    // Read the JSON output
    const jsonPath = path.join(outputDir, `${baseName}.json`);
    if (!fs.existsSync(jsonPath)) {
      throw new Error(`whisper.cpp did not produce output at ${jsonPath}`);
    }

    const raw = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    const durationMs = Date.now() - start;

    // Parse whisper.cpp JSON format
    const segments: TranscriptSegment[] = (raw.transcription ?? []).map(
      (seg: { timestamps: { from: string; to: string }; text: string }) => ({
        start_ms: parseTimestamp(seg.timestamps.from),
        end_ms: parseTimestamp(seg.timestamps.to),
        text: seg.text.trim(),
        speaker,
      })
    );

    const fullText = segments.map((s) => s.text).join(" ");

    // Clean up the JSON output file
    fs.unlinkSync(jsonPath);

    return {
      segments,
      fullText,
      provider: "whisper.cpp",
      durationMs,
    };
  }
}

// Parse "HH:MM:SS.mmm" timestamp to milliseconds
function parseTimestamp(ts: string): number {
  const parts = ts.split(":");
  if (parts.length !== 3) return 0;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const secParts = parts[2].split(".");
  const seconds = parseInt(secParts[0], 10);
  const ms = parseInt((secParts[1] ?? "0").padEnd(3, "0").slice(0, 3), 10);
  return hours * 3600000 + minutes * 60000 + seconds * 1000 + ms;
}
