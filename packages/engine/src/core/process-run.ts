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
  cleanMicForSpeech,
  writeAecSidecar,
  mergeTimedAudioFiles,
  analyzeAudioLevels,
  chooseConservativeGainDb,
  correctStreamDrift,
  type AsrAudioFormat,
  type AnchorQuality,
  type SpeechCleanupQuality,
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
  sourceKind?: "raw-mic" | "denoised-mic" | "cleaned-mic" | "system" | "unknown";
  gainDb?: number;
  offsetMetadata?: { source: "aec-sidecar" | "capture-meta" | "none"; offsetMs: number };
  logger: Logger;
  signal?: AbortSignal;
}

export async function transcribeAudio(opts: TranscribeAudioOptions): Promise<TranscriptResult> {
  const {
    config,
    runFolder,
    audioPath,
    speaker = "unknown",
    logger,
    sourceKind = "unknown",
    gainDb = 0,
    offsetMetadata = { source: "none", offsetMs: 0 },
  } = opts;
  throwIfAborted(opts.signal);

  logger.info("Transcription input started", {
    audioPath,
    speaker,
    sourceKind,
    gainDb,
    hasOffsetMetadata: offsetMetadata.source !== "none",
    offsetSource: offsetMetadata.source,
    offsetMs: offsetMetadata.offsetMs,
  });

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
    await normalizeAudio(audioPath, normalizedPath, asrFormat, { gainDb });
    audioForAsr = normalizedPath;
    logger.info("Audio normalized for ASR", {
      path: normalizedPath,
      format: asrFormat,
      gainDb,
    });
  } catch (err) {
    logger.warn("Audio normalization failed, using original file", {
      audioPath,
      speaker,
      sourceKind,
      gainDb,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const result = await asr.transcribe(audioForAsr, speaker, { signal: opts.signal });
  throwIfAborted(opts.signal);
  logger.info("Transcription complete", {
    provider: result.provider,
    segments: result.segments.length,
    durationMs: result.durationMs,
    audioPath,
    speaker,
    sourceKind,
    gainDb,
    offsetSource: offsetMetadata.source,
  });

  return result;
}

/**
 * Load `audio/capture-meta.json` and return a hint offset + anchor-quality
 * classification. Consumers use the quality flag to decide whether to trust
 * the anchor as the primary alignment source or to rely more on xcorr.
 *
 * Anchor quality ladder:
 *  - `trusted`  — structured per-stream first-sample anchors are present
 *                 from the "good" sources (`stderr-time` for mic,
 *                 `first-chunk` for system). End-anchor (if available)
 *                 agrees within ±150ms. Upgraded to `trusted+` internally
 *                 when both agree, but the external enum stays `trusted`.
 *  - `degraded` — at least one stream is anchored from a fallback source
 *                 (`spawn-time` / `tee-start`), or start- and end-anchors
 *                 disagree sharply. Hint is still used but xcorr gets a
 *                 wider search.
 *  - `missing`  — no capture-meta or malformed. No hint; full xcorr search.
 */
function readCaptureHintOffsetMs(audioDir: string): number {
  return readCaptureHintOffset(audioDir).offsetMs;
}

interface CaptureHint {
  found: boolean;
  /**
   * Offset in ms to apply to the system track when mixing relative to mic.
   * Convention: positive value means the system track's first content sample
   * is LATER (in wall-clock) than mic's — which is the opposite of what
   * "positive = system lags mic" would suggest. We use the cross-correlation
   * convention throughout: positive offsetMs corresponds to `-itsoffset
   * -offsetMs/1000`, i.e., advance system forward to match mic[0].
   *
   * Derivation from capture-meta: `micFirstSampleAtMs − systemFirstSampleAtMs`.
   * When mic started later (typical AVFoundation warmup), offset is POSITIVE.
   */
  offsetMs: number;
  quality: AnchorQuality;
  /** Cross-check: |start-anchor − end-anchor|. Set when both exist. */
  anchorDisagreementMs?: number;
  /** Which derivation produced `offsetMs` (for logging). */
  offsetDerivation?: "start-anchor" | "end-anchor" | "legacy";
  micSource?: string;
  systemSource?: string;
}

function readCaptureHintOffset(audioDir: string): CaptureHint {
  const metaPath = path.join(audioDir, "capture-meta.json");
  if (!fs.existsSync(metaPath)) {
    return { found: false, offsetMs: 0, quality: "missing" };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    // Prefer the structured per-stream anchors when present.
    const micFirst = readNumber(raw?.mic?.firstSampleAtMs);
    const sysFirst = readNumber(raw?.system?.firstSampleAtMs);
    const micSource: string | undefined = raw?.mic?.firstSampleSource;
    const sysSource: string | undefined = raw?.system?.firstSampleSource;
    const micEnd = readNumber(raw?.mic?.endAnchorAtMs);
    const sysEnd = readNumber(raw?.system?.endAnchorAtMs);

    if (micFirst !== null && sysFirst !== null) {
      const startOffset = micFirst - sysFirst;
      const trustedSources =
        micSource === "stderr-time" && sysSource === "first-chunk";

      // Cross-check with end-anchor offset when both sides have it.
      let endOffset: number | undefined;
      let disagreement: number | undefined;
      if (micEnd !== null && sysEnd !== null) {
        endOffset = micEnd - sysEnd;
        disagreement = Math.abs(startOffset - endOffset);
      }

      if (trustedSources) {
        // Trusted start anchors: use them as primary. Sharp disagreement
        // with the end anchor downgrades to `degraded` — but we still
        // report the start-anchor offset since we trust the sources.
        const quality: AnchorQuality =
          disagreement !== undefined && disagreement > 300
            ? "degraded"
            : "trusted";
        return {
          found: true,
          offsetMs: startOffset,
          quality,
          anchorDisagreementMs: disagreement,
          offsetDerivation: "start-anchor",
          micSource,
          systemSource: sysSource,
        };
      }

      // One or both start sources are fallback (spawn-time / tee-start).
      // End anchors (stop-time − ffprobe duration) are independent of the
      // fallback sources and typically much more accurate, so prefer them.
      if (endOffset !== undefined) {
        return {
          found: true,
          offsetMs: endOffset,
          quality: "degraded",
          anchorDisagreementMs: disagreement,
          offsetDerivation: "end-anchor",
          micSource,
          systemSource: sysSource,
        };
      }

      return {
        found: true,
        offsetMs: startOffset,
        quality: "degraded",
        anchorDisagreementMs: disagreement,
        offsetDerivation: "start-anchor",
        micSource,
        systemSource: sysSource,
      };
    }

    // Legacy fallback: pre-structured capture-meta schema.
    const mic = readNumber(raw?.micStartedAtMs);
    const sys = readNumber(raw?.systemStartedAtMs);
    if (mic === null || sys === null) {
      return { found: false, offsetMs: 0, quality: "missing" };
    }
    return {
      found: true,
      offsetMs: mic - sys,
      quality: "degraded",
      offsetDerivation: "legacy",
    };
  } catch {
    return { found: false, offsetMs: 0, quality: "missing" };
  }
}

function readNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

type AudioSpeaker = "me" | "others" | "unknown";
type OffsetSource = "aec-sidecar" | "capture-meta" | "none";
type AudioSourceKind = "raw-mic" | "denoised-mic" | "cleaned-mic" | "system" | "unknown";

interface AudioTrackContext {
  path: string;
  speaker: AudioSpeaker;
  sourceKind: AudioSourceKind;
  offsetMs: number;
  offsetSource: OffsetSource;
  gainDb: number;
  levels: { meanVolumeDb: number; maxVolumeDb: number; isSilent: boolean } | null;
  /** Only set for `me` tracks; undefined for `others`/`unknown`. */
  cleanupQuality?: SpeechCleanupQuality;
}

function classifyAudioSourceKind(audioPath: string, speaker: AudioSpeaker): AudioSourceKind {
  const base = path.basename(audioPath);
  if (base === "mic.clean.wav") return "cleaned-mic";
  if (base === "mic.voice.wav") return "denoised-mic";
  if (base === "system.wav" || speaker === "others") return "system";
  if (base === "mic.wav" || speaker === "me") return "raw-mic";
  return "unknown";
}

function readAecOffset(dir: string): { found: boolean; offsetMs: number } {
  const sidecarPath = path.join(dir, "aec.json");
  if (!fs.existsSync(sidecarPath)) return { found: false, offsetMs: 0 };
  try {
    const raw = JSON.parse(fs.readFileSync(sidecarPath, "utf-8"));
    // Accept both xcorr-derived and hint-anchor-derived offsets as truth:
    // the AEC step has already chosen the alignment it applied to the
    // cleaned mic, so the downstream mix must match that choice.
    if (raw && typeof raw.offsetMs === "number") {
      if (raw.source === "xcorr" &&
          typeof raw.confidence === "number" &&
          raw.confidence > 0) {
        return { found: true, offsetMs: raw.offsetMs };
      }
      if (raw.source === "timestamp-hint") {
        return { found: true, offsetMs: raw.offsetMs };
      }
    }
  } catch {
    // Ignore malformed sidecar; fall back to capture metadata.
  }
  return { found: false, offsetMs: 0 };
}

export function resolveTrackOffsetMetadata(
  audioPath: string,
  runFolder: string
): { offsetMs: number; source: OffsetSource } {
  const dir = path.dirname(audioPath);
  const audioRoot = path.join(runFolder, "audio");

  const sidecarOffset = readAecOffset(dir);
  if (sidecarOffset.found) {
    return { offsetMs: sidecarOffset.offsetMs, source: "aec-sidecar" };
  }

  const localCapture = readCaptureHintOffset(dir);
  if (localCapture.found) {
    return { offsetMs: localCapture.offsetMs, source: "capture-meta" };
  }

  if (dir !== audioRoot) {
    const rootCapture = readCaptureHintOffset(audioRoot);
    if (rootCapture.found) {
      return { offsetMs: rootCapture.offsetMs, source: "capture-meta" };
    }
  }

  return { offsetMs: 0, source: "none" };
}

async function buildAudioTrackContexts(
  audioFiles: { path: string; speaker: AudioSpeaker }[],
  runFolder: string,
  cleanupQualityByPath?: Map<string, SpeechCleanupQuality>
): Promise<AudioTrackContext[]> {
  const contexts = await Promise.all(
    audioFiles.map(async (audioFile) => {
      const sourceKind = classifyAudioSourceKind(audioFile.path, audioFile.speaker);
      const offsetMetadata = resolveTrackOffsetMetadata(audioFile.path, runFolder);

      let levels: AudioTrackContext["levels"] = null;
      let gainDb = 0;
      try {
        levels = await analyzeAudioLevels(audioFile.path);
        gainDb = chooseConservativeGainDb(levels);
      } catch {
        // Best-effort only; keep the raw input when analysis fails.
      }

      const cleanupQuality: SpeechCleanupQuality | undefined =
        audioFile.speaker === "me"
          ? cleanupQualityByPath?.get(audioFile.path) ?? "raw-mic"
          : undefined;

      return {
        path: audioFile.path,
        speaker: audioFile.speaker,
        sourceKind,
        offsetMs: offsetMetadata.offsetMs,
        offsetSource: offsetMetadata.source,
        gainDb,
        levels,
        cleanupQuality,
      };
    })
  );
  return contexts;
}

/**
 * Per-stream drift correction using capture-meta's wall-clock timestamps
 * vs ffprobe-reported file duration. Best-effort: any failure just leaves
 * the stream uncorrected and logs.
 */
async function correctDriftFromCaptureMeta(
  audioFiles: { path: string; speaker: "me" | "others" | "unknown" }[],
  runFolder: string,
  logger: Logger,
  signal?: AbortSignal
): Promise<void> {
  const audioRoot = path.join(runFolder, "audio");
  const metaPath = path.join(audioRoot, "capture-meta.json");
  if (!fs.existsSync(metaPath)) return;
  let meta: {
    mic?: { firstSampleAtMs?: number; stoppedAtMs?: number };
    system?: { firstSampleAtMs?: number; stoppedAtMs?: number };
  };
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  } catch {
    return;
  }

  const wallClock = (
    stream: "mic" | "system"
  ): number | null => {
    const s = meta[stream];
    if (!s) return null;
    const first = typeof s.firstSampleAtMs === "number" ? s.firstSampleAtMs : null;
    const stopped = typeof s.stoppedAtMs === "number" ? s.stoppedAtMs : null;
    if (first === null || stopped === null || stopped <= first) return null;
    return stopped - first;
  };

  for (const af of audioFiles) {
    throwIfAborted(signal);
    // Map speaker/file to the capture-meta stream key.
    let streamKey: "mic" | "system" | null = null;
    const base = path.basename(af.path);
    if (base === "mic.wav" || af.speaker === "me") streamKey = "mic";
    else if (base === "system.wav" || af.speaker === "others") streamKey = "system";
    if (!streamKey) continue;

    const wall = wallClock(streamKey);
    if (wall === null) continue;

    try {
      const result = await correctStreamDrift(af.path, wall, { logger });
      logger.info("Drift correction", {
        audioPath: af.path,
        stream: streamKey,
        applied: result.applied,
        reason: result.reason,
        fileDurationMs: result.fileDurationMs ?? null,
        wallClockMs: result.wallClockMs ?? null,
        atempo: result.atempo ?? null,
        correctedDurationMs: result.correctedDurationMs ?? null,
      });
    } catch (err) {
      logger.warn("Drift correction threw; continuing with uncorrected audio", {
        audioPath: af.path,
        stream: streamKey,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Returns a per-mic-input map of speech-cleanup quality, keyed by the
 * *original* raw mic path. Later pipeline stages (AEC, track-context
 * building) consult this to stamp tracks with their true cleanup quality.
 */
async function preprocessMicForSpeech(
  audioFiles: { path: string; speaker: "me" | "others" | "unknown" }[],
  logger: Logger,
  signal?: AbortSignal
): Promise<Map<string, SpeechCleanupQuality>> {
  const qualityByPath = new Map<string, SpeechCleanupQuality>();
  for (const af of audioFiles) {
    if (af.speaker !== "me") continue;
    throwIfAborted(signal);

    const rawMicPath = af.path;
    const dir = path.dirname(rawMicPath);
    const voicePath = path.join(dir, "mic.voice.wav");

    let beforeLevels: Awaited<ReturnType<typeof analyzeAudioLevels>> | null = null;
    try {
      beforeLevels = await analyzeAudioLevels(rawMicPath);
    } catch {
      beforeLevels = null;
    }

    try {
      const cleanup = await cleanMicForSpeech(rawMicPath, voicePath, logger);
      if (!fs.existsSync(voicePath)) {
        qualityByPath.set(rawMicPath, "raw-mic");
        continue;
      }
      af.path = voicePath;
      qualityByPath.set(rawMicPath, cleanup.quality);
      qualityByPath.set(voicePath, cleanup.quality);

      let afterLevels: Awaited<ReturnType<typeof analyzeAudioLevels>> | null = null;
      try {
        afterLevels = await analyzeAudioLevels(voicePath);
      } catch {
        afterLevels = null;
      }

      logger.info("Mic speech cleanup complete", {
        rawMicPath,
        voicePath,
        strategy: cleanup.strategy,
        cleanupQuality: cleanup.quality,
        modelPath: cleanup.modelPath ?? null,
        beforeMeanVolumeDb: beforeLevels?.meanVolumeDb ?? null,
        beforeMaxVolumeDb: beforeLevels?.maxVolumeDb ?? null,
        afterMeanVolumeDb: afterLevels?.meanVolumeDb ?? null,
        afterMaxVolumeDb: afterLevels?.maxVolumeDb ?? null,
      });
    } catch (err) {
      qualityByPath.set(rawMicPath, "raw-mic");
      logger.warn("Mic speech cleanup failed; keeping raw mic", {
        rawMicPath,
        cleanupQuality: "raw-mic",
        error: err instanceof Error ? err.message : String(err),
        beforeMeanVolumeDb: beforeLevels?.meanVolumeDb ?? null,
        beforeMaxVolumeDb: beforeLevels?.maxVolumeDb ?? null,
      });
    }
  }
  return qualityByPath;
}

/**
 * For each `me` entry in `audioFiles` that has a sibling `system.wav` in
 * the same directory, run alignment + AEC to produce a `mic.clean.wav`
 * and rewrite the entry's `path` to the cleaned file. Failures are
 * logged but never throw: the speech-cleaned mic remains the transcript
 * input in that case.
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
      // Pull hint + anchor-quality from capture-meta.json. It lives at
      // runFolder/audio (flat) or one level up for segmented layout.
      const audioRoot = path.join(runFolder, "audio");
      let hint = readCaptureHintOffset(audioRoot);
      if (!hint.found && dir !== audioRoot) {
        hint = readCaptureHintOffset(dir);
      }

      const anchorQuality: AnchorQuality = hint.quality;

      logger.info("AEC: capture-meta hint", {
        dir,
        hintMs: Math.round(hint.offsetMs),
        timingAnchor: anchorQuality,
        offsetDerivation: hint.offsetDerivation ?? null,
        micSource: hint.micSource ?? null,
        systemSource: hint.systemSource ?? null,
        anchorDisagreementMs:
          hint.anchorDisagreementMs !== undefined
            ? Math.round(hint.anchorDisagreementMs)
            : null,
      });

      // Trusted anchors get a tight xcorr window (refinement only);
      // degraded / missing keep the wide default so xcorr can still win.
      const { offsetMs: xcorrOffsetMs, confidence } = await estimateMicSystemOffsetMs(
        micPath,
        systemPath,
        {
          hintOffsetMs: hint.found ? hint.offsetMs : 0,
          anchorQuality,
          logger,
        }
      );

      // Decide final offset from hint + xcorr.
      let finalOffsetMs: number;
      let finalSource: "xcorr" | "hint-anchor" | "low-confidence";
      if (anchorQuality === "trusted") {
        // Primary = hint. Accept xcorr only if it corroborates within
        // ±300ms; otherwise stick with the anchor.
        if (confidence > 0 && Math.abs(xcorrOffsetMs - hint.offsetMs) <= 300) {
          finalOffsetMs = xcorrOffsetMs;
          finalSource = "xcorr";
        } else {
          finalOffsetMs = hint.offsetMs;
          finalSource = "hint-anchor";
        }
      } else if (anchorQuality === "degraded") {
        // Prefer xcorr if it fires confidently; otherwise use the degraded
        // hint and mark low-confidence.
        if (confidence > 0) {
          finalOffsetMs = xcorrOffsetMs;
          finalSource = "xcorr";
        } else if (hint.found) {
          finalOffsetMs = hint.offsetMs;
          finalSource = "low-confidence";
        } else {
          finalOffsetMs = 0;
          finalSource = "low-confidence";
        }
      } else {
        // `missing` anchors: only trust xcorr.
        if (confidence > 0) {
          finalOffsetMs = xcorrOffsetMs;
          finalSource = "xcorr";
        } else {
          finalOffsetMs = 0;
          finalSource = "low-confidence";
        }
      }

      if (finalSource === "low-confidence") {
        logger.warn("AEC: alignment is low-confidence; skipping AEC", {
          dir,
          timingAnchor: anchorQuality,
          finalOffsetMs: Math.round(finalOffsetMs),
          confidence,
        });
        writeAecSidecar(sidecarPath, {
          offsetMs: finalOffsetMs,
          confidence,
          source: "skipped",
          micPath,
          systemPath,
          writtenAt: new Date().toISOString(),
        });
        continue;
      }

      await cancelSystemFromMic(micPath, systemPath, cleanedPath, finalOffsetMs, logger);
      if (fs.existsSync(cleanedPath)) {
        writeAecSidecar(sidecarPath, {
          offsetMs: finalOffsetMs,
          confidence,
          source: finalSource === "hint-anchor" ? "timestamp-hint" : "xcorr",
          micPath,
          systemPath,
          cleanedMicPath: cleanedPath,
          writtenAt: new Date().toISOString(),
        });
        af.path = cleanedPath;
        logger.info("AEC: mic cleaned", {
          dir,
          offsetMs: Math.round(finalOffsetMs),
          confidence,
          alignmentSource: finalSource,
          timingAnchor: anchorQuality,
        });
      }
    } catch (err) {
      logger.warn("AEC: preprocessing failed; keeping speech-cleaned mic", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Collapse audio intermediates in each segment directory down to a single
 * `mic.wav` (the best available mic track), plus the untouched `system.wav`
 * and `combined.wav`. Removes `mic.voice.wav`, `mic.clean.wav`, any
 * `normalized-*.{wav,ogg}` scratch files, and any orphaned `.raw` files.
 */
function collapseAudioArtifacts(
  trackContexts: AudioTrackContext[],
  runFolder: string,
  logger: Logger
): void {
  const seenDirs = new Set<string>();

  for (const track of trackContexts) {
    if (track.speaker !== "me") continue;
    const dir = path.dirname(track.path);
    seenDirs.add(dir);
    const finalMicPath = path.join(dir, "mic.wav");

    // If the final mic isn't already `mic.wav`, atomically replace it.
    if (track.path !== finalMicPath && fs.existsSync(track.path)) {
      try {
        fs.renameSync(track.path, finalMicPath);
        logger.info("Collapsed mic artifact", {
          from: track.path,
          to: finalMicPath,
          cleanupQuality: track.cleanupQuality ?? null,
        });
        track.path = finalMicPath;
      } catch (err) {
        logger.warn("Failed to rename final mic to mic.wav", {
          from: track.path,
          to: finalMicPath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Also include the audio root in case `normalized-*` landed there.
  seenDirs.add(path.join(runFolder, "audio"));

  const intermediateNames = new Set(["mic.voice.wav", "mic.clean.wav"]);
  const intermediatePrefixes = ["normalized-"];
  const intermediateSuffixes = [".system-recording.raw"];

  for (const dir of seenDirs) {
    if (!fs.existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const shouldRemove =
        intermediateNames.has(entry) ||
        intermediatePrefixes.some((p) => entry.startsWith(p)) ||
        intermediateSuffixes.some((s) => entry.endsWith(s));
      if (!shouldRemove) continue;
      const full = path.join(dir, entry);
      try {
        fs.rmSync(full, { force: true });
      } catch {
        // Best effort.
      }
    }
  }
}

/**
 * Best-effort combined playback file covering the cleaned mic + system
 * across all audio files. Non-blocking / non-fatal.
 */
async function writeCombinedPlayback(
  trackContexts: AudioTrackContext[],
  runFolder: string,
  logger: Logger
): Promise<void> {
  const inputs = trackContexts.filter((track) => fs.existsSync(track.path));
  if (inputs.length < 2) return;
  const combinedPath = path.join(runFolder, "audio", "combined.wav");
  try {
    for (const input of inputs) {
      logger.info("Combined audio input prepared", {
        path: input.path,
        speaker: input.speaker,
        sourceKind: input.sourceKind,
        cleanupQuality: input.cleanupQuality ?? null,
        offsetMs: input.speaker === "others" ? input.offsetMs : 0,
        offsetSource: input.offsetSource,
        gainDb: input.gainDb,
        meanVolumeDb: input.levels?.meanVolumeDb ?? null,
        maxVolumeDb: input.levels?.maxVolumeDb ?? null,
      });
    }
    await mergeTimedAudioFiles(
      inputs.map((input) => ({
        path: input.path,
        offsetMs: input.speaker === "others" ? input.offsetMs : 0,
        gainDb: input.gainDb,
      })),
      combinedPath
    );
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

  // --- Speech cleanup: remove steady room/background noise from the mic ---
  //
  // We denoise the mic before alignment so cross-correlation and ASR both
  // operate on a cleaner speech signal. If cleanup fails, the raw mic stays
  // in place and the run still proceeds.
  // --- Drift correction: fix sample-rate divergence before any further processing ---
  //
  // USB audio interfaces routinely lose samples under load, producing a
  // file whose declared sample rate understates the number of
  // milliseconds actually captured (e.g., 50.2s of wall-clock elapsed →
  // 44.5s of audio written). Left uncorrected, the mix starts in sync but
  // drifts apart over the length of the recording. Stretch each stream
  // back to its wall-clock duration so downstream steps (denoise, AEC,
  // ASR, mix) operate on time-correct audio.
  await correctDriftFromCaptureMeta(audioFiles, runFolder, logger, signal);

  const cleanupQualityByPath = await preprocessMicForSpeech(audioFiles, logger, signal);

  // --- AEC preprocessing: remove re-captured system audio from the mic ---
  //
  // When the user has speakers on, the mic re-captures the remote
  // participants' voices, and ASR ends up attributing those segments to
  // `me`. We produce a cleaned mic track aligned with the system track
  // and route it through ASR instead of the denoised-only mic. Best-effort:
  // if any step fails, we keep the speech-cleaned mic.
  if (config.recording.aec_enabled !== false) {
    await preprocessMicForAec(audioFiles, runFolder, logger, signal);
    // Propagate cleanup quality through the AEC step: if mic.voice.wav was
    // the input, mic.clean.wav inherits the same cleanup provenance.
    for (const af of audioFiles) {
      if (af.speaker === "me") {
        const existing = cleanupQualityByPath.get(af.path);
        if (!existing) {
          // af.path was rewritten to mic.clean.wav; inherit from the voice
          // track it was derived from (same directory, mic.voice.wav).
          const voiceSibling = path.join(path.dirname(af.path), "mic.voice.wav");
          const inherited = cleanupQualityByPath.get(voiceSibling);
          if (inherited) cleanupQualityByPath.set(af.path, inherited);
        }
      }
    }
  }

  const trackContexts = await buildAudioTrackContexts(
    audioFiles,
    runFolder,
    cleanupQualityByPath
  );

  // --- Transcription (in parallel for multiple sources) ---
  let transcriptResult: TranscriptResult;
  const transcriptStartedAt = Date.now();
  let activeTrack: AudioTrackContext | null = null;
  try {
    const transcripts = [];
    for (const track of trackContexts) {
      throwIfAborted(signal);
      activeTrack = track;
      transcripts.push(
        await transcribeAudio({
          config,
          runFolder,
          audioPath: track.path,
          speaker: track.speaker,
          sourceKind: track.sourceKind,
          gainDb: track.gainDb,
          offsetMetadata: {
            source: track.offsetSource,
            offsetMs: track.offsetMs,
          },
          logger,
          signal,
        })
      );
    }
    activeTrack = null;
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
    logger.error("Transcription failed", {
      error: msg,
      activeInput: activeTrack
        ? {
            path: activeTrack.path,
            speaker: activeTrack.speaker,
            sourceKind: activeTrack.sourceKind,
            gainDb: activeTrack.gainDb,
            offsetSource: activeTrack.offsetSource,
            offsetMs: activeTrack.offsetMs,
          }
        : null,
      inputs: trackContexts.map((track) => ({
        path: track.path,
        speaker: track.speaker,
        sourceKind: track.sourceKind,
        gainDb: track.gainDb,
        offsetSource: track.offsetSource,
        offsetMs: track.offsetMs,
      })),
    });
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
    await writeCombinedPlayback(trackContexts, runFolder, logger);
  } catch (err) {
    logger.warn("writeCombinedPlayback failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Collapse intermediates: the user-visible run folder should only contain
  // `mic.wav` (final best mic track), `system.wav`, `combined.wav`, and the
  // small JSON sidecars. Intermediate WAVs (`mic.voice.wav`, `mic.clean.wav`,
  // `normalized-*.{wav,ogg}`) are deleted. Best-effort — never fail the run.
  try {
    collapseAudioArtifacts(trackContexts, runFolder, logger);
  } catch (err) {
    logger.warn("collapseAudioArtifacts failed", {
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
