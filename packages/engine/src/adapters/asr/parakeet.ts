import fs from "node:fs";
import path from "node:path";
import type { AsrProvider, TranscriptResult, TranscriptSegment, AsrCallOptions } from "./provider.js";
import { runCommand } from "../../core/exec.js";

interface ParakeetSentence {
  text: string;
  start: number;
  end: number;
  duration?: number;
  tokens?: Array<{ text: string; start: number; end: number; duration?: number }>;
}

interface ParakeetJson {
  text: string;
  sentences: ParakeetSentence[];
}

export class ParakeetMlxProvider implements AsrProvider {
  private binaryPath: string;
  private model: string;

  constructor(opts: { binaryPath: string; model: string }) {
    this.binaryPath = opts.binaryPath;
    this.model = opts.model;
  }

  async transcribe(
    audioPath: string,
    speaker: "me" | "others" | "unknown" = "unknown",
    options?: AsrCallOptions
  ): Promise<TranscriptResult> {
    if (!fs.existsSync(this.binaryPath)) {
      throw new Error(
        `Parakeet binary not found at ${this.binaryPath}. ` +
        `Run "meeting-notes setup-asr" to install Parakeet.`
      );
    }

    const start = Date.now();
    const outputDir = path.dirname(audioPath);
    const baseName = path.basename(audioPath, path.extname(audioPath));
    // mlx_audio.stt.generate appends .json to --output-path when --format json
    const outputBase = path.join(outputDir, `${baseName}-parakeet`);
    const jsonPath = `${outputBase}.json`;

    const args = [
      "--model", this.model,
      "--audio", audioPath,
      "--output-path", outputBase,
      "--format", "json",
    ];

    try {
      await runCommand(this.binaryPath, args, {
        timeoutMs: 1_800_000,
        signal: options?.signal,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Parakeet (mlx_audio.stt.generate) failed: ${msg}\n` +
        `\nCommand: ${this.binaryPath} ${args.join(" ")}\n` +
        `\nTry reinstalling: rm -rf ~/.meeting-notes/parakeet-venv && meeting-notes setup-asr`
      );
    }

    if (!fs.existsSync(jsonPath)) {
      throw new Error(`Parakeet did not produce output JSON at ${jsonPath}`);
    }

    const raw = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as ParakeetJson;
    const durationMs = Date.now() - start;

    const segments: TranscriptSegment[] = (raw.sentences ?? []).map((s) => ({
      start_ms: Math.round(s.start * 1000),
      end_ms: Math.round(s.end * 1000),
      text: s.text.trim(),
      speaker,
    }));

    const fullText = raw.text?.trim() ?? segments.map((s) => s.text).join(" ");

    // Clean up the JSON output file
    try {
      fs.unlinkSync(jsonPath);
    } catch {
      // ignore cleanup errors
    }

    return {
      segments,
      fullText,
      provider: "parakeet-mlx",
      durationMs,
    };
  }
}
