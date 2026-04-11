import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "./config.js";
import { updateRunStatus, loadRunManifest } from "./run.js";
import type { RunStore } from "./run-store.js";

/**
 * Compute (ended - started) in fractional minutes from the on-disk
 * manifest. Returns null if either timestamp is missing or invalid.
 */
function computeDurationMinutes(runFolder: string, endedIso: string, store?: RunStore): number | null {
  try {
    const m = store ? store.loadManifest(runFolder) : loadRunManifest(runFolder);
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
  planPipelineSteps,
  runPipeline,
  type LlmCallFn,
  type PipelineInput,
  type PipelineProgressEvent,
  type PipelinePlannedStep,
} from "./pipeline.js";
import { getSecret, requireSecret } from "./secrets.js";
import { ClaudeProvider } from "../adapters/llm/claude.js";
import { OpenAIProvider } from "../adapters/llm/openai.js";
import { OllamaProvider } from "../adapters/llm/ollama.js";
import { classifyModel } from "../adapters/llm/resolve.js";
import { normalizeLocalModelId } from "./setup-llm.js";
import type { LlmProvider } from "../adapters/llm/provider.js";
import type { AsrProvider, TranscriptResult } from "../adapters/asr/provider.js";
import { normalizeAudio, asrAudioExtension, type AsrAudioFormat } from "./audio.js";
import { formatTranscriptMarkdown, buildTranscriptForLlm, buildSpeakerExcerpts } from "./transcript.js";
import { writeMarkdownFile } from "./markdown.js";
import type { Logger } from "../logging/logger.js";
import { throwIfAborted } from "./abort.js";

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
  signal?: AbortSignal;
}

export async function transcribeAudio(opts: TranscribeAudioOptions): Promise<TranscriptResult> {
  const { config, runFolder, audioPath, speaker = "unknown", logger } = opts;
  throwIfAborted(opts.signal);

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

  const result = await asr.transcribe(audioForAsr, speaker, { signal: opts.signal });
  throwIfAborted(opts.signal);
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
  /** Explicit prompt ids to run after transcription. Empty array means transcript only. */
  onlyIds?: string[];
  /**
   * When true (default), only builtin + auto-enabled prompts run.
   * Set false to run every enabled prompt regardless of `auto` frontmatter.
   */
  autoOnly?: boolean;
  /** Live progress callback forwarded to the pipeline. */
  onProgress?: (event: PipelineProgressEvent) => void;
  signal?: AbortSignal;
  /** Optional RunStore for state persistence. */
  store?: RunStore;
}

export async function processRun(opts: ProcessRunOptions): Promise<{
  succeeded: string[];
  failed: string[];
}> {
  const {
    config,
    runFolder,
    title,
    date,
    audioFiles,
    logger,
    onlyIds,
    autoOnly = true,
    onProgress,
    signal,
    store,
  } = opts;
  const transcriptStep: PipelinePlannedStep = {
    promptOutputId: "__transcript__",
    label: "Build transcript",
    filename: "transcript.md",
    kind: "transcript",
  };
  const hasExplicitPromptSelection = onlyIds !== undefined;

  updateRunStatus(runFolder, "processing", undefined, store);
  throwIfAborted(signal);
  const plannedPrompts = hasExplicitPromptSelection
    ? onlyIds.length > 0
      ? await planPipelineSteps(config, runFolder, logger, { onlyIds, store })
      : []
    : await planPipelineSteps(config, runFolder, logger, { autoOnly, store });
  onProgress?.({
    type: "run-planned",
    steps: [
      transcriptStep,
      ...plannedPrompts.map((prompt) => ({
        promptOutputId: prompt.id,
        label: prompt.label,
        filename: prompt.filename,
        model: prompt.model ?? undefined,
        kind: "prompt" as const,
      })),
    ],
  });
  onProgress?.({
    type: "output-start",
    promptOutputId: transcriptStep.promptOutputId,
    label: transcriptStep.label,
    filename: transcriptStep.filename,
  });

  // --- Transcription (in parallel for multiple sources) ---
  let transcriptResult: TranscriptResult;
  const transcriptStartedAt = Date.now();
  try {
    const transcripts = [];
    for (const af of audioFiles) {
      throwIfAborted(signal);
      transcripts.push(
        await transcribeAudio({
          config,
          runFolder,
          audioPath: af.path,
          speaker: af.speaker,
          logger,
          signal,
        })
      );
    }
    transcriptResult = transcripts.length === 1 ? transcripts[0] : mergeTranscripts(transcripts);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Transcription failed", { error: msg });
    onProgress?.({
      type: "output-failed",
      promptOutputId: transcriptStep.promptOutputId,
      label: transcriptStep.label,
      filename: transcriptStep.filename,
      error: msg,
      latencyMs: Date.now() - transcriptStartedAt,
    });
    {
      const endedIso = new Date().toISOString();
      updateRunStatus(runFolder, "error", {
        ended: endedIso,
        duration_minutes: computeDurationMinutes(runFolder, endedIso, store),
      }, store);
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
  onProgress?.({
    type: "output-complete",
    promptOutputId: transcriptStep.promptOutputId,
    label: transcriptStep.label,
    filename: transcriptStep.filename,
    latencyMs: Date.now() - transcriptStartedAt,
  });

  // --- LLM Pipeline ---
  // Build a provider factory that dispatches per-call based on the model id.
  // Per-prompt frontmatter can override the default, so a single run may
  // touch both Claude and Ollama. We only require the Anthropic key when
  // a Claude model is actually selected somewhere — fully-local users
  // should never be told to set a key they don't need.
  const defaultModel =
    config.llm_provider === "ollama" ? config.ollama.model : (config.llm_provider === "openai" ? config.openai.model : config.claude.model);
  const claudeKey = await getSecret("claude");
  const openaiKey = await getSecret("openai");
  const claudeCache: Record<string, ClaudeProvider> = {};
  const openaiCache: Record<string, OpenAIProvider> = {};
  const ollamaCache: Record<string, OllamaProvider> = {};
  const llmFactory = (model?: string): LlmProvider => {
    const id = model && model.trim() ? model : defaultModel;
    const kind = classifyModel(id);
    if (kind === "claude") {
      if (!claudeKey) {
        throw new Error(
          `Prompt requested Claude model "${id}" but no Anthropic API key is set. ` +
            `Add one in Settings → LLM, or change the prompt's model to a local one.`
        );
      }
      return (claudeCache[id] ??= new ClaudeProvider(claudeKey, id));
    }
    if (kind === "openai") {
      if (!openaiKey) {
        throw new Error(
          `Prompt requested OpenAI model "${id}" but no OpenAI API key is set. ` +
            `Add one in Settings → LLM, or change the prompt's model to a local one.`
        );
      }
      return (openaiCache[id] ??= new OpenAIProvider(openaiKey, id));
    }
    const normalizedId = normalizeLocalModelId(id) || id;
    return (ollamaCache[normalizedId] ??= new OllamaProvider(config.ollama.base_url, normalizedId));
  };

  // If the *default* provider is Claude/OpenAI and no key exists, skip the whole
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
        duration_minutes: computeDurationMinutes(runFolder, endedIso, store),
      }, store);
    }
    return { succeeded: [], failed: [] };
  }
  if (config.llm_provider === "openai" && !openaiKey) {
    logger.warn(
      "LLM pipeline skipped — no OpenAI API key in macOS Keychain " +
        "(run 'meeting-notes set-key openai' or switch llm_provider to 'ollama')"
    );
    {
      const endedIso = new Date().toISOString();
      updateRunStatus(runFolder, "complete", {
        ended: endedIso,
        duration_minutes: computeDurationMinutes(runFolder, endedIso, store),
      }, store);
    }
    return { succeeded: [], failed: [] };
  }
  const notesPath = path.join(runFolder, "notes.md");
  const manualNotes = fs.existsSync(notesPath)
    ? fs.readFileSync(notesPath, "utf-8")
    : "";

  // Read prep notes and text attachments for pipeline context
  const prepPath = path.join(runFolder, "prep.md");
  const prepNotes = fs.existsSync(prepPath) ? fs.readFileSync(prepPath, "utf-8") : "";
  const attachmentsDir = path.join(runFolder, "attachments");
  let attachmentContext = "";
  if (fs.existsSync(attachmentsDir)) {
    for (const entry of fs.readdirSync(attachmentsDir)) {
      const ext = path.extname(entry).toLowerCase();
      if ([".txt", ".md"].includes(ext)) {
        attachmentContext += `\n\n--- ${entry} ---\n` + fs.readFileSync(path.join(attachmentsDir, entry), "utf-8");
      }
    }
  }

  const input: PipelineInput = {
    transcript: buildTranscriptForLlm(transcriptResult),
    manualNotes,
    title,
    date,
    meExcerpts: buildSpeakerExcerpts(transcriptResult, "me"),
    othersExcerpts: buildSpeakerExcerpts(transcriptResult, "others"),
    prepNotes,
    attachmentContext,
  };
  const llmCall: LlmCallFn = (
    systemPrompt: string,
    userMessage: string,
    model?: string,
    pipelineSignal?: AbortSignal
  ) => llmFactory(model).call(systemPrompt, userMessage, model, { signal: pipelineSignal });

  if (plannedPrompts.length === 0) {
    const endedIso = new Date().toISOString();
    updateRunStatus(runFolder, "complete", {
      ended: endedIso,
      duration_minutes: computeDurationMinutes(runFolder, endedIso, store),
    }, store);
    return { succeeded: [], failed: [] };
  }

  const results = await runPipeline(
    config,
    runFolder,
    input,
    llmCall,
    logger,
    {
      onlyIds: hasExplicitPromptSelection ? onlyIds : undefined,
      autoOnly: hasExplicitPromptSelection ? undefined : autoOnly,
      onProgress,
      signal,
      plannedPrompts,
      store,
    }
  );

  const succeeded = results.filter((r) => r.success).map((r) => r.promptOutputId);
  const failed = results.filter((r) => !r.success).map((r) => r.promptOutputId);

  {
    const endedIso = new Date().toISOString();
    updateRunStatus(runFolder, failed.length === 0 ? "complete" : "error", {
      ended: endedIso,
      duration_minutes: computeDurationMinutes(runFolder, endedIso, store),
    }, store);
  }

  return { succeeded, failed };
}
