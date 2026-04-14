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
import { OllamaProvider, unloadOllamaModels } from "../adapters/llm/ollama.js";
import { classifyModel } from "../adapters/llm/resolve.js";
import { normalizeLocalModelId } from "./setup-llm.js";
import type { LlmProvider } from "../adapters/llm/provider.js";
import type { AsrProvider, TranscriptResult } from "../adapters/asr/provider.js";
import {
  normalizeAudio,
  asrAudioExtension,
  estimateMicSystemOffsetMs,
  cancelSystemFromMic,
  writeAecSidecar,
  mergeAudioFiles,
  type AsrAudioFormat,
} from "./audio.js";
import {
  formatTranscriptMarkdown,
  buildTranscriptForLlm,
  buildSpeakerExcerpts,
  dedupOverlappingSpeakers,
} from "./transcript.js";
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

/**
 * Load `audio/capture-meta.json` (written by the app's recording flow)
 * and return the hint offset (mic-start minus system-start, in ms) that
 * seeds cross-correlation during alignment. Returns 0 when the file is
 * missing or malformed — the alignment will still work, just with a
 * wider search.
 */
function readCaptureHintOffsetMs(audioDir: string): number {
  const metaPath = path.join(audioDir, "capture-meta.json");
  if (!fs.existsSync(metaPath)) return 0;
  try {
    const raw = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    const mic = typeof raw.micStartedAtMs === "number" ? raw.micStartedAtMs : null;
    const sys = typeof raw.systemStartedAtMs === "number" ? raw.systemStartedAtMs : null;
    if (mic == null || sys == null) return 0;
    // Offset convention: positive means the system track lags the mic.
    return sys - mic;
  } catch {
    return 0;
  }
}

/**
 * For each `me` entry in `audioFiles` that has a sibling `system.wav` in
 * the same directory, run alignment + AEC to produce a `mic.clean.wav`
 * and rewrite the entry's `path` to the cleaned file. Failures are
 * logged but never throw: the raw mic track remains the transcript input
 * in that case.
 */
async function preprocessMicForAec(
  audioFiles: { path: string; speaker: "me" | "others" | "unknown" }[],
  runFolder: string,
  logger: Logger,
  signal?: AbortSignal
): Promise<void> {
  for (const af of audioFiles) {
    if (af.speaker !== "me") continue;
    throwIfAborted(signal);

    const micPath = af.path;
    const dir = path.dirname(micPath);
    const systemPath = path.join(dir, "system.wav");
    if (!fs.existsSync(systemPath)) continue;

    const cleanedPath = path.join(dir, "mic.clean.wav");
    const sidecarPath = path.join(dir, "aec.json");

    try {
      // Hint offset from capture-meta.json lives at runFolder/audio (flat)
      // or a level above for segmented layout — check both.
      const audioRoot = path.join(runFolder, "audio");
      let hintMs = readCaptureHintOffsetMs(audioRoot);
      if (hintMs === 0 && dir !== audioRoot) {
        // Segmented layout: capture-meta.json still sits at audio/, but
        // segments may have been started later; the hint is approximate
        // either way, so 0 is a safe default.
        hintMs = readCaptureHintOffsetMs(dir);
      }

      const { offsetMs, confidence } = await estimateMicSystemOffsetMs(
        micPath,
        systemPath,
        { hintOffsetMs: hintMs, logger }
      );

      if (confidence <= 0) {
        logger.info("AEC: alignment unreliable; keeping raw mic", {
          dir,
          hintMs: Math.round(hintMs),
        });
        writeAecSidecar(sidecarPath, {
          offsetMs: 0,
          confidence: 0,
          source: "skipped",
          micPath,
          systemPath,
          writtenAt: new Date().toISOString(),
        });
        continue;
      }

      await cancelSystemFromMic(micPath, systemPath, cleanedPath, offsetMs, logger);
      if (fs.existsSync(cleanedPath)) {
        writeAecSidecar(sidecarPath, {
          offsetMs,
          confidence,
          source: "xcorr",
          micPath,
          systemPath,
          cleanedMicPath: cleanedPath,
          writtenAt: new Date().toISOString(),
        });
        af.path = cleanedPath;
        logger.info("AEC: mic cleaned", {
          dir,
          offsetMs: Math.round(offsetMs),
          confidence,
        });
      }
    } catch (err) {
      logger.warn("AEC: preprocessing failed; keeping raw mic", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Best-effort combined playback file covering the cleaned mic + system
 * across all audio files. Non-blocking / non-fatal.
 */
async function writeCombinedPlayback(
  audioFiles: { path: string; speaker: "me" | "others" | "unknown" }[],
  runFolder: string,
  logger: Logger
): Promise<void> {
  const inputs = audioFiles.map((a) => a.path).filter((p) => fs.existsSync(p));
  if (inputs.length < 2) return;
  const combinedPath = path.join(runFolder, "audio", "combined.wav");
  try {
    await mergeAudioFiles(inputs, combinedPath);
    logger.info("Combined audio created", { path: combinedPath, inputs: inputs.length });
  } catch (err) {
    logger.warn("Failed to create combined audio", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
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
  const defaultModel =
    config.llm_provider === "ollama" ? config.ollama.model : (config.llm_provider === "openai" ? config.openai.model : config.claude.model);
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
        model: prompt.model ?? defaultModel,
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

  // --- AEC preprocessing: remove re-captured system audio from the mic ---
  //
  // When the user has speakers on, the mic re-captures the remote
  // participants' voices, and ASR ends up attributing those segments to
  // `me`. We produce a cleaned mic track aligned with the system track
  // and route it through ASR instead of the raw mic. Best-effort: if any
  // step fails, we fall back to the raw mic.
  if (config.recording.aec_enabled !== false) {
    await preprocessMicForAec(audioFiles, runFolder, logger, signal);
  }

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
    if (config.recording.dedup_me_against_others !== false) {
      const before = transcriptResult.segments.length;
      transcriptResult = dedupOverlappingSpeakers(transcriptResult);
      const dropped = before - transcriptResult.segments.length;
      if (dropped > 0) {
        logger.info("Transcript dedup: dropped me-segments overlapping others", {
          dropped,
        });
      }
    }
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

  // Build the combined.wav playback file from the (possibly AEC-cleaned)
  // per-channel audio. We await it here rather than fire-and-forget so any
  // ffmpeg failure is logged via the run logger, but we never let a merge
  // failure abort the processing job.
  try {
    await writeCombinedPlayback(audioFiles, runFolder, logger);
  } catch (err) {
    logger.warn("writeCombinedPlayback failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // --- LLM Pipeline ---
  // Build a provider factory that dispatches per-call based on the model id.
  // Per-prompt frontmatter can override the default, so a single run may
  // touch both Claude and Ollama. We only require the Anthropic key when
  // a Claude model is actually selected somewhere — fully-local users
  // should never be told to set a key they don't need.
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

  // Free Ollama model memory now that all prompts are done.
  if (config.llm_provider === "ollama") {
    try {
      await unloadOllamaModels(config.ollama.base_url);
    } catch {
      // Best effort — don't fail the run over cleanup.
    }
  }

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
