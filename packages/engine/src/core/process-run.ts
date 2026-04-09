import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "./config.js";
import { updateRunStatus, loadRunManifest } from "./run.js";

/**
 * Compute (ended - started) in fractional minutes from the on-disk
 * manifest. Returns null if either timestamp is missing or invalid.
 */
function computeDurationMinutes(runFolder: string, endedIso: string): number | null {
  try {
    const m = loadRunManifest(runFolder);
    if (!m.started) return null;
    const startMs = Date.parse(m.started);
    const endMs = Date.parse(endedIso);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      return null;
    }
    return (endMs - startMs) / 60000;
  } catch {
    return null;
  }
}
import {
  runPipeline,
  type PipelineInput,
  type PipelineProgressEvent,
} from "./pipeline.js";
import { getSecret, requireSecret } from "./secrets.js";
import { ClaudeProvider } from "../adapters/llm/claude.js";
import { OllamaProvider } from "../adapters/llm/ollama.js";
import { classifyModel } from "../adapters/llm/resolve.js";
import type { LlmProvider } from "../adapters/llm/provider.js";
import type { AsrProvider, TranscriptResult } from "../adapters/asr/provider.js";
import { normalizeAudio, asrAudioExtension, type AsrAudioFormat } from "./audio.js";
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

  // Pick the normalization format based on the ASR provider:
  // - OpenAI has a 25 MB per-file upload limit. At 16 kHz mono PCM WAV that
  //   caps at ~13 minutes. Transcoding to 32 kbps Opus gives ~100 minutes
  //   per channel with no measurable WER hit on speech content.
  // - Local providers (Parakeet, whisper-local) have no upload cost, so we
  //   keep lossless WAV to avoid any theoretical quality loss.
  const asrFormat: AsrAudioFormat =
    config.asr_provider === "openai" ? "opus32k" : "wav16";
  const normalizedExt = asrAudioExtension(asrFormat);
  const normalizedPath = path.join(
    runFolder,
    "audio",
    `normalized-${path.basename(audioPath, path.extname(audioPath))}${normalizedExt}`
  );
  let audioForAsr = audioPath;
  try {
    await normalizeAudio(audioPath, normalizedPath, asrFormat);
    audioForAsr = normalizedPath;
    logger.info("Audio normalized for ASR", { path: normalizedPath, format: asrFormat });
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
  /** Live progress callback forwarded to the pipeline. */
  onProgress?: (event: PipelineProgressEvent) => void;
}

export async function processRun(opts: ProcessRunOptions): Promise<{
  succeeded: string[];
  failed: string[];
}> {
  const { config, runFolder, title, date, audioFiles, logger, autoOnly = true, onProgress } = opts;

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
    {
      const endedIso = new Date().toISOString();
      updateRunStatus(runFolder, "error", {
        ended: endedIso,
        duration_minutes: computeDurationMinutes(runFolder, endedIso),
      });
    }
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
  // Build a provider factory that dispatches per-call based on the model id.
  // Per-prompt frontmatter can override the default, so a single run may
  // touch both Claude and Ollama. We only require the Anthropic key when
  // a Claude model is actually selected somewhere — fully-local users
  // should never be told to set a key they don't need.
  const defaultModel =
    config.llm_provider === "ollama" ? config.ollama.model : config.claude.model;
  const claudeKey = await getSecret("claude");
  const claudeCache: Record<string, ClaudeProvider> = {};
  const ollamaCache: Record<string, OllamaProvider> = {};
  const llmFactory = (model?: string): LlmProvider => {
    const id = model && model.trim() ? model : defaultModel;
    if (classifyModel(id) === "claude") {
      if (!claudeKey) {
        throw new Error(
          `Prompt requested Claude model "${id}" but no Anthropic API key is set. ` +
            `Add one in Settings → LLM, or change the prompt's model to a local one.`
        );
      }
      return (claudeCache[id] ??= new ClaudeProvider(claudeKey, id));
    }
    return (ollamaCache[id] ??= new OllamaProvider(config.ollama.base_url, id));
  };

  // If the *default* provider is Claude and no key exists, skip the whole
  // pipeline with a clear log line — same behavior as before, but only
  // when local models aren't going to take over.
  if (config.llm_provider === "claude" && !claudeKey) {
    logger.warn(
      "LLM pipeline skipped — no Anthropic API key in macOS Keychain " +
        "(run 'meeting-notes set-key claude' or switch llm_provider to 'ollama')"
    );
    {
      const endedIso = new Date().toISOString();
      updateRunStatus(runFolder, "complete", {
        ended: endedIso,
        duration_minutes: computeDurationMinutes(runFolder, endedIso),
      });
    }
    return { succeeded: [], failed: [] };
  }
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
    (sys, usr, model) => llmFactory(model).call(sys, usr, model),
    logger,
    { autoOnly, onProgress }
  );

  const succeeded = results.filter((r) => r.success).map((r) => r.sectionId);
  const failed = results.filter((r) => !r.success).map((r) => r.sectionId);

  {
    const endedIso = new Date().toISOString();
    updateRunStatus(runFolder, failed.length === 0 ? "complete" : "error", {
      ended: endedIso,
      duration_minutes: computeDurationMinutes(runFolder, endedIso),
    });
  }

  return { succeeded, failed };
}
