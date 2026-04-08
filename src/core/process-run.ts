import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "./config.js";
import { updateRunStatus } from "./run.js";
import { runPipeline, type PipelineInput } from "./pipeline.js";
import { getSecret, requireSecret } from "./secrets.js";
import { ClaudeProvider } from "../adapters/llm/claude.js";
import type { AsrProvider, TranscriptResult } from "../adapters/asr/provider.js";
import { normalizeAudio } from "./audio.js";
import { formatTranscriptMarkdown, buildTranscriptForLlm, buildSpeakerExcerpts } from "./transcript.js";
import { writeMarkdownFile } from "./markdown.js";
import type { Logger } from "../logging/logger.js";

export async function createAsrProvider(config: AppConfig): Promise<AsrProvider> {
  if (config.asr_provider === "openai") {
    const apiKey = await requireSecret("openai");
    const { OpenAIWhisperProvider } = await import("../adapters/asr/openai.js");
    return new OpenAIWhisperProvider(apiKey);
  }

  if (config.asr_provider === "parakeet-mlx") {
    const { ParakeetMlxProvider } = await import("../adapters/asr/parakeet.js");
    return new ParakeetMlxProvider({
      binaryPath: config.parakeet_mlx.binary_path,
      model: config.parakeet_mlx.model,
    });
  }

  const { WhisperLocalProvider } = await import("../adapters/asr/whisper-local.js");
  return new WhisperLocalProvider({
    binaryPath: config.whisper_local.binary_path,
    modelPath: config.whisper_local.model_path,
  });
}

interface TranscribeAudioOptions {
  config: AppConfig;
  runFolder: string;
  audioPath: string;
  speaker?: "me" | "others" | "unknown";
  logger: Logger;
}

export async function transcribeAudio(opts: TranscribeAudioOptions): Promise<TranscriptResult> {
  const { config, runFolder, audioPath, speaker = "unknown", logger } = opts;

  const asr = await createAsrProvider(config);

  // Normalize audio for ASR
  const normalizedPath = path.join(runFolder, "audio", `normalized-${path.basename(audioPath, path.extname(audioPath))}.wav`);
  let audioForAsr = audioPath;
  try {
    await normalizeAudio(audioPath, normalizedPath);
    audioForAsr = normalizedPath;
    logger.info("Audio normalized for ASR", { path: normalizedPath });
  } catch (err) {
    logger.warn("Audio normalization failed, using original file", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const result = await asr.transcribe(audioForAsr, speaker);
  logger.info("Transcription complete", {
    provider: result.provider,
    segments: result.segments.length,
    durationMs: result.durationMs,
  });

  return result;
}

export function mergeTranscripts(results: TranscriptResult[]): TranscriptResult {
  // Merge segments from multiple sources, sorted by start time
  const allSegments = results
    .flatMap((r) => r.segments)
    .sort((a, b) => a.start_ms - b.start_ms);

  return {
    segments: allSegments,
    fullText: allSegments.map((s) => s.text).join(" "),
    provider: results.map((r) => r.provider).join("+"),
    durationMs: Math.max(...results.map((r) => r.durationMs)),
  };
}

interface ProcessRunOptions {
  config: AppConfig;
  runFolder: string;
  title: string;
  date: string;
  audioFiles: { path: string; speaker: "me" | "others" | "unknown" }[];
  logger: Logger;
  /**
   * When true (default), only builtin + auto-enabled prompts run.
   * Set false to run every enabled prompt regardless of `auto` frontmatter.
   */
  autoOnly?: boolean;
}

export async function processRun(opts: ProcessRunOptions): Promise<{
  succeeded: string[];
  failed: string[];
}> {
  const { config, runFolder, title, date, audioFiles, logger, autoOnly = true } = opts;

  updateRunStatus(runFolder, "processing");

  // --- Transcription (in parallel for multiple sources) ---
  let transcriptResult: TranscriptResult;
  try {
    const transcripts = await Promise.all(
      audioFiles.map((af) =>
        transcribeAudio({
          config,
          runFolder,
          audioPath: af.path,
          speaker: af.speaker,
          logger,
        })
      )
    );
    transcriptResult = transcripts.length === 1 ? transcripts[0] : mergeTranscripts(transcripts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Transcription failed", { error: msg });
    updateRunStatus(runFolder, "error", { ended: new Date().toISOString() });
    throw err;
  }

  // Write transcript.md
  writeMarkdownFile(
    path.join(runFolder, "transcript.md"),
    {
      type: "meeting-transcript",
      provider: transcriptResult.provider,
      segments: transcriptResult.segments.length,
      transcription_duration_ms: transcriptResult.durationMs,
      generated_at: new Date().toISOString(),
    },
    formatTranscriptMarkdown(transcriptResult)
  );

  // --- LLM Pipeline ---
  const claudeKey = await getSecret("claude");
  if (!claudeKey) {
    logger.warn("LLM pipeline skipped — no Anthropic API key in macOS Keychain (run 'meeting-notes set-key claude')");
    updateRunStatus(runFolder, "complete", {
      ended: new Date().toISOString(),
    });
    return { succeeded: [], failed: [] };
  }

  const claude = new ClaudeProvider(claudeKey, config.claude.model);
  const notesPath = path.join(runFolder, "notes.md");
  const manualNotes = fs.existsSync(notesPath)
    ? fs.readFileSync(notesPath, "utf-8")
    : "";

  const input: PipelineInput = {
    transcript: buildTranscriptForLlm(transcriptResult),
    manualNotes,
    title,
    date,
    meExcerpts: buildSpeakerExcerpts(transcriptResult, "me"),
    othersExcerpts: buildSpeakerExcerpts(transcriptResult, "others"),
  };

  const results = await runPipeline(
    config,
    runFolder,
    input,
    (sys, usr) => claude.call(sys, usr),
    logger,
    { autoOnly }
  );

  const succeeded = results.filter((r) => r.success).map((r) => r.sectionId);
  const failed = results.filter((r) => !r.success).map((r) => r.sectionId);

  updateRunStatus(runFolder, failed.length === 0 ? "complete" : "error", {
    ended: new Date().toISOString(),
  });

  return { succeeded, failed };
}
