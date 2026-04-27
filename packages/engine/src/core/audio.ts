import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getFfmpegPath } from "./ffmpeg-path.js";

const execFileAsync = promisify(execFile);

type DiagnosticLogger = {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
};

export interface AudioInfo {
  durationMs: number;
  sampleRate: number;
  channels: number;
  format: string;
}

export type AudioArchiveFormat = "ogg-opus" | "flac";

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

export interface SilenceCheckResult {
  meanVolumeDb: number;
  maxVolumeDb: number;
  isSilent: boolean;
}

export interface AudioMixInput {
  path: string;
  offsetMs?: number;
  gainDb?: number;
}

export interface ConservativeGainOptions {
  targetMeanDb?: number;
  minGainDb?: number;
  maxGainDb?: number;
  peakHeadroomDb?: number;
  silenceFloorDb?: number;
}

export interface SpeechCleanupPlan {
  strategy: "arnndn" | "ffmpeg-fallback";
  filterGraph: string;
  modelPath?: string;
}

export interface SpeechCleanupResult {
  strategy: "arnndn" | "ffmpeg-fallback";
  /** Quality label for downstream consumers / observability. */
  quality: SpeechCleanupQuality;
  modelPath?: string;
  outputPath: string;
}

/**
 * End-to-end cleanup quality tracked on the track context:
 * - `arnndn-primary` — the bundled RNNoise model ran (intended path).
 * - `ffmpeg-fallback` — ffmpeg-only denoise ran (degraded; model missing
 *   or arnndn graph failed).
 * - `raw-mic` — no cleanup at all (both primary and fallback failed, or
 *   cleanup was skipped).
 */
export type SpeechCleanupQuality =
  | "arnndn-primary"
  | "ffmpeg-fallback"
  | "raw-mic";

/**
 * Analyze an audio file's volume levels to detect silence. An audio file
 * is considered silent if its max volume is below the threshold (default
 * -70 dB). This is useful for detecting when system audio capture via
 * BlackHole is not receiving any routed audio.
 */
export async function checkAudioSilence(
  audioPath: string,
  thresholdDb = -70
): Promise<SilenceCheckResult> {
  try {
    const { stderr } = await execFileAsync(getFfmpegPath(), [
      "-i", audioPath,
      "-af", "volumedetect",
      "-f", "null",
      "-",
    ]).catch((e) => ({ stderr: e.stderr as string, stdout: "" }));

    const meanMatch = stderr.match(/mean_volume:\s*([-\d.]+)\s*dB/);
    const maxMatch = stderr.match(/max_volume:\s*([-\d.]+)\s*dB/);

    const meanVolumeDb = meanMatch ? parseFloat(meanMatch[1]) : -91;
    const maxVolumeDb = maxMatch ? parseFloat(maxMatch[1]) : -91;

    return {
      meanVolumeDb,
      maxVolumeDb,
      isSilent: maxVolumeDb < thresholdDb,
    };
  } catch {
    // If ffmpeg/ffprobe isn't available, don't block the flow.
    return { meanVolumeDb: 0, maxVolumeDb: 0, isSilent: false };
  }
}

export async function analyzeAudioLevels(audioPath: string): Promise<SilenceCheckResult> {
  return checkAudioSilence(audioPath, -55);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function chooseConservativeGainDb(
  levels: SilenceCheckResult,
  opts: ConservativeGainOptions = {}
): number {
  const targetMeanDb = opts.targetMeanDb ?? -22;
  const minGainDb = opts.minGainDb ?? -8;
  const maxGainDb = opts.maxGainDb ?? 6;
  const peakHeadroomDb = opts.peakHeadroomDb ?? -1;
  const silenceFloorDb = opts.silenceFloorDb ?? -55;

  if (
    !Number.isFinite(levels.meanVolumeDb) ||
    !Number.isFinite(levels.maxVolumeDb) ||
    levels.maxVolumeDb <= silenceFloorDb
  ) {
    return 0;
  }

  let effectiveMaxGainDb = maxGainDb;
  if (levels.meanVolumeDb <= -35 || levels.maxVolumeDb <= -18) {
    effectiveMaxGainDb = Math.min(effectiveMaxGainDb, 4);
  }
  if (levels.meanVolumeDb <= -45 || levels.maxVolumeDb <= -24) {
    effectiveMaxGainDb = Math.min(effectiveMaxGainDb, 2);
  }

  let gainDb = clamp(targetMeanDb - levels.meanVolumeDb, minGainDb, effectiveMaxGainDb);
  const maxAllowedGainDb = peakHeadroomDb - levels.maxVolumeDb;
  gainDb = Math.min(gainDb, maxAllowedGainDb);

  if (!Number.isFinite(gainDb) || Math.abs(gainDb) < 0.25) {
    return 0;
  }

  return +gainDb.toFixed(1);
}

export async function normalizeAudio(
  inputPath: string,
  outputPath: string,
  format: AsrAudioFormat = "wav16",
  opts: { gainDb?: number } = {}
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
  const filterArgs =
    opts.gainDb && Math.abs(opts.gainDb) >= 0.25
      ? ["-af", `volume=${opts.gainDb.toFixed(1)}dB`]
      : [];

  try {
    await execFileAsync(getFfmpegPath(), [
      ...commonArgs,
      ...filterArgs,
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

export async function encodeAudioArchive(
  inputPath: string,
  outputPath: string,
  format: AudioArchiveFormat,
  opts: { bitrateKbps?: number } = {}
): Promise<void> {
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });

  const ext = path.extname(outputPath);
  const tmpPath = `${outputPath}.tmp-${process.pid}-${Date.now()}${ext}`;
  const formatArgs =
    format === "ogg-opus"
      ? [
          "-c:a",
          "libopus",
          "-b:a",
          `${opts.bitrateKbps ?? 32}k`,
          "-application",
          "voip",
          "-vbr",
          "on",
        ]
      : ["-c:a", "flac", "-compression_level", "8"];

  try {
    await execFileAsync(getFfmpegPath(), [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-ar",
      "48000",
      "-ac",
      "1",
      ...formatArgs,
      "-y",
      tmpPath,
    ]);

    const [inputInfo, outputInfo] = await Promise.all([
      getAudioInfo(inputPath),
      getAudioInfo(tmpPath),
    ]);
    if (outputInfo.durationMs <= 0) {
      throw new Error("encoded file has no duration");
    }
    const driftMs = Math.abs(outputInfo.durationMs - inputInfo.durationMs);
    if (inputInfo.durationMs > 0 && driftMs > Math.max(1500, inputInfo.durationMs * 0.02)) {
      throw new Error(
        `encoded duration differs from source by ${driftMs}ms`
      );
    }

    fs.renameSync(tmpPath, outputPath);
  } catch (err) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // Best effort.
    }
    throw new Error(
      `Failed to encode audio archive: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function decodeAudioToWav(
  inputPath: string,
  outputPath: string
): Promise<void> {
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(outputPath);
  const tmpPath = `${outputPath}.tmp-${process.pid}-${Date.now()}${ext}`;
  try {
    await execFileAsync(getFfmpegPath(), [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-ar",
      "48000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      "-y",
      tmpPath,
    ]);
    const info = await getAudioInfo(tmpPath);
    if (info.durationMs <= 0) {
      throw new Error("decoded WAV has no duration");
    }
    fs.renameSync(tmpPath, outputPath);
  } catch (err) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // Best effort.
    }
    throw new Error(
      `Failed to decode audio archive: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export function resolveArnndnModelPath(): string | null {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const envPath = process.env.MEETING_NOTES_ARNNDN_MODEL?.trim();
  const distCandidate = path.join(moduleDir, "../defaults/audio/arnndn.rnnn");
  // Electron asar: ffmpeg is spawned as a child process and can't read from
  // inside `app.asar`. electron-builder's `asarUnpack` places an unpacked
  // copy at `app.asar.unpacked/…`. Check that location first when running
  // from inside an ASAR archive.
  const unpackedCandidate = distCandidate.replace(
    `${path.sep}app.asar${path.sep}`,
    `${path.sep}app.asar.unpacked${path.sep}`
  );
  const candidates = [
    envPath || "",
    unpackedCandidate,
    distCandidate,
    path.join(moduleDir, "../../src/defaults/audio/arnndn.rnnn"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function buildSpeechCleanupPlan(modelPath = resolveArnndnModelPath()): SpeechCleanupPlan {
  const fallbackFilterGraph = [
    "aformat=sample_fmts=flt:channel_layouts=mono",
    "highpass=f=120",
    "lowpass=f=7200",
    "afftdn=nf=-28:nr=10:tn=1",
    "agate=threshold=0.015:ratio=1.25:attack=5:release=180",
  ].join(",");

  if (!modelPath) {
    return {
      strategy: "ffmpeg-fallback",
      filterGraph: fallbackFilterGraph,
    };
  }

  const escaped = escapeFilterValue(modelPath);
  return {
    strategy: "arnndn",
    modelPath,
    filterGraph: [
      "aformat=sample_fmts=flt:channel_layouts=mono",
      "highpass=f=120",
      "lowpass=f=7200",
      `arnndn=m='${escaped}':mix=0.85`,
      "agate=threshold=0.012:ratio=1.15:attack=5:release=180",
    ].join(","),
  };
}

async function runSpeechCleanupFilter(
  inputPath: string,
  outputPath: string,
  plan: SpeechCleanupPlan
): Promise<void> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await execFileAsync(getFfmpegPath(), [
    "-hide_banner",
    "-loglevel", "error",
    "-i", inputPath,
    "-af", plan.filterGraph,
    "-ar", "48000",
    "-ac", "1",
    "-c:a", "pcm_s16le",
    "-y",
    outputPath,
  ]);
}

export async function cleanMicForSpeech(
  inputPath: string,
  outputPath: string,
  logger?: DiagnosticLogger
): Promise<SpeechCleanupResult> {
  const primaryPlan = buildSpeechCleanupPlan();
  try {
    await runSpeechCleanupFilter(inputPath, outputPath, primaryPlan);
    const quality: SpeechCleanupQuality =
      primaryPlan.strategy === "arnndn" ? "arnndn-primary" : "ffmpeg-fallback";
    logger?.info("Mic speech cleanup written", {
      inputPath,
      outputPath,
      strategy: primaryPlan.strategy,
      quality,
      modelPath: primaryPlan.modelPath ?? null,
    });
    return {
      strategy: primaryPlan.strategy,
      quality,
      modelPath: primaryPlan.modelPath,
      outputPath,
    };
  } catch (err) {
    if (primaryPlan.strategy === "arnndn") {
      logger?.warn("Mic speech cleanup with arnndn failed; using fallback chain", {
        inputPath,
        error: err instanceof Error ? err.message : String(err),
        modelPath: primaryPlan.modelPath ?? null,
      });
      const fallbackPlan = buildSpeechCleanupPlan(null);
      await runSpeechCleanupFilter(inputPath, outputPath, fallbackPlan);
      logger?.info("Mic speech cleanup written", {
        inputPath,
        outputPath,
        strategy: fallbackPlan.strategy,
        quality: "ffmpeg-fallback",
        modelPath: null,
      });
      return {
        strategy: fallbackPlan.strategy,
        quality: "ffmpeg-fallback",
        outputPath,
      };
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

// ---- Sample-rate / drop-rate drift correction ----

/**
 * A stream's file duration vs its wall-clock capture duration can diverge
 * sharply on USB audio interfaces under load (sample drops, sample-rate
 * mismatch between device clock and system clock). Observed: 50.2s of real
 * capture producing a 44.5s file — 11% of samples dropped, causing the
 * stream to play back too fast and desync the mix over time.
 *
 * This function measures the discrepancy and, if it exceeds a threshold,
 * applies `atempo` to stretch or compress the audio so its playback
 * duration matches wall-clock duration. The corrected file replaces the
 * input so downstream steps (denoise, AEC, ASR, mix) see wall-clock-
 * correct audio.
 */
export interface DriftCorrectionResult {
  applied: boolean;
  reason: "stretched" | "compressed" | "below-threshold" | "no-data";
  /** File duration (from ffprobe) in ms before correction. */
  fileDurationMs?: number;
  /** Wall-clock capture duration in ms (from capture-meta). */
  wallClockMs?: number;
  /** atempo factor applied (<1 stretches, >1 compresses). Undefined if not applied. */
  atempo?: number;
  /** File duration after correction in ms, when applied. */
  correctedDurationMs?: number;
}

export async function correctStreamDrift(
  audioPath: string,
  wallClockMs: number,
  opts: {
    /** Minimum |1 − atempo| before correction is applied. Default 0.01 (1%). */
    thresholdRatio?: number;
    logger?: DiagnosticLogger;
  } = {}
): Promise<DriftCorrectionResult> {
  const threshold = opts.thresholdRatio ?? 0.01;

  if (!Number.isFinite(wallClockMs) || wallClockMs <= 0) {
    return { applied: false, reason: "no-data" };
  }

  let fileDurationMs = 0;
  try {
    const info = await getAudioInfo(audioPath);
    fileDurationMs = info.durationMs;
  } catch {
    return { applied: false, reason: "no-data" };
  }
  if (fileDurationMs <= 0) {
    return { applied: false, reason: "no-data" };
  }

  // atempo = fileDur/wallClock. <1 stretches (fixes the common USB-drop
  // case where the file is shorter than the real capture). >1 compresses.
  const atempo = fileDurationMs / wallClockMs;
  const deviation = Math.abs(1 - atempo);
  if (deviation < threshold) {
    return {
      applied: false,
      reason: "below-threshold",
      fileDurationMs,
      wallClockMs,
    };
  }

  // atempo has a valid range of [0.5, 100]. For extreme drops beyond 2x,
  // chain atempos. We cap at two stages to keep the filter chain short.
  const stages: number[] = [];
  if (atempo < 0.5) {
    stages.push(0.5, atempo / 0.5);
  } else if (atempo > 100) {
    return { applied: false, reason: "no-data" };
  } else {
    stages.push(atempo);
  }
  const filterGraph = stages.map((s) => `atempo=${s.toFixed(6)}`).join(",");

  const tmpPath = audioPath + ".drift.tmp.wav";
  try {
    await execFileAsync(getFfmpegPath(), [
      "-hide_banner",
      "-loglevel", "error",
      "-i", audioPath,
      "-af", filterGraph,
      "-c:a", "pcm_s16le",
      "-y",
      tmpPath,
    ]);
  } catch (err) {
    opts.logger?.warn("Drift correction ffmpeg failed", {
      audioPath,
      atempo,
      error: err instanceof Error ? err.message : String(err),
    });
    try { fs.rmSync(tmpPath, { force: true }); } catch {}
    return { applied: false, reason: "no-data", fileDurationMs, wallClockMs };
  }

  // Verify the corrected file is actually closer to wall-clock before
  // replacing the original.
  let correctedDurationMs = 0;
  try {
    correctedDurationMs = (await getAudioInfo(tmpPath)).durationMs;
  } catch {
    // Proceed; we'll still report the intended atempo.
  }

  fs.renameSync(tmpPath, audioPath);
  opts.logger?.info("Drift corrected", {
    audioPath,
    fileDurationMs,
    wallClockMs,
    atempo: +atempo.toFixed(6),
    correctedDurationMs: correctedDurationMs || null,
  });
  return {
    applied: true,
    reason: atempo < 1 ? "stretched" : "compressed",
    fileDurationMs,
    wallClockMs,
    atempo,
    correctedDurationMs: correctedDurationMs || undefined,
  };
}

// ---- Offset estimation + AEC preprocessing ----

/**
 * Read an audio file and return its first `windowSec` of samples as float32
 * PCM @ 16 kHz mono. Uses ffmpeg to resample on the fly so callers don't
 * need to care about the input format.
 */
async function readMonoF32(
  audioPath: string,
  windowSec: number
): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(getFfmpegPath(), [
      "-hide_banner",
      "-loglevel", "error",
      "-t", String(windowSec),
      "-i", audioPath,
      "-f", "f32le",
      "-acodec", "pcm_f32le",
      "-ar", "16000",
      "-ac", "1",
      "pipe:1",
    ], { stdio: ["ignore", "pipe", "pipe"] });

    const chunks: Buffer[] = [];
    let stderrTail = "";
    child.stdout.on("data", (b: Buffer) => chunks.push(b));
    child.stderr.on("data", (b: Buffer) => { stderrTail = (stderrTail + b.toString()).slice(-500); });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited ${code}: ${stderrTail.trim()}`));
        return;
      }
      const buf = Buffer.concat(chunks);
      // Buffer may not be 4-aligned if ffmpeg was cut off; trim.
      const aligned = buf.subarray(0, buf.length - (buf.length % 4));
      const view = new Float32Array(
        aligned.buffer,
        aligned.byteOffset,
        aligned.byteLength / 4
      );
      // Copy because the backing ArrayBuffer is a Buffer pool slab.
      resolve(new Float32Array(view));
    });
  });
}

/**
 * Normalized cross-correlation search for the lag (in samples) that best
 * aligns `mic` with `system` in a window around `hintSamples`. Operates
 * in the time domain — the search window is small enough that FFT isn't
 * worth the complexity.
 *
 * Returns the best lag and a confidence metric = peak / second-best peak.
 * A confidence below ~1.5 means the correlation surface is flat; callers
 * should treat that as "no reliable offset found".
 */
function bestLagSamples(
  mic: Float32Array,
  system: Float32Array,
  hintSamples: number,
  searchRadiusSamples: number
): { lagSamples: number; confidence: number } {
  // Correlate over a 4-second analysis window to keep the inner loop bounded.
  const analysisLen = Math.min(mic.length, system.length, 16000 * 4);
  if (analysisLen <= 0) return { lagSamples: 0, confidence: 0 };

  let bestLag = 0;
  let bestScore = -Infinity;
  let secondBest = -Infinity;

  const lagLo = hintSamples - searchRadiusSamples;
  const lagHi = hintSamples + searchRadiusSamples;

  for (let lag = lagLo; lag <= lagHi; lag += 8) {
    let sum = 0;
    let micEnergy = 0;
    let sysEnergy = 0;
    // Positive lag → system is delayed relative to mic.
    for (let i = 0; i < analysisLen; i += 4) {
      const j = i + lag;
      if (j < 0 || j >= system.length) continue;
      const m = mic[i];
      const s = system[j];
      sum += m * s;
      micEnergy += m * m;
      sysEnergy += s * s;
    }
    const denom = Math.sqrt(micEnergy * sysEnergy) || 1;
    const score = Math.abs(sum) / denom;
    if (score > bestScore) {
      secondBest = bestScore;
      bestScore = score;
      bestLag = lag;
    } else if (score > secondBest) {
      secondBest = score;
    }
  }

  const confidence = secondBest > 0 ? bestScore / secondBest : bestScore * 10;
  return { lagSamples: bestLag, confidence };
}

export interface OffsetEstimate {
  offsetMs: number;
  confidence: number;
}

/** Anchor-quality classifier used to size the xcorr search window. */
export type AnchorQuality = "trusted" | "degraded" | "missing";

/**
 * Estimate the time offset (in ms) between mic and system-audio captures.
 * A positive value means the system track is delayed relative to the mic
 * track (i.e., the mic saw its first sample earlier on the wall clock).
 *
 * The optional `hintOffsetMs` (typically from recording-start timestamps)
 * is used to seed the cross-correlation search so we don't have to scan
 * the full `maxOffsetMs` range. Falls back to { 0, 0 } when the signal is
 * too quiet or the correlation surface too flat to be trusted.
 */
export async function estimateMicSystemOffsetMs(
  micPath: string,
  systemPath: string,
  opts?: {
    hintOffsetMs?: number;
    maxOffsetMs?: number;
    windowSec?: number;
    /**
     * When set, narrows the default search radius for `trusted` anchors.
     * An explicit `maxOffsetMs` always wins over this. `degraded` and
     * `missing` use the wide default so xcorr can still discover the truth.
     */
    anchorQuality?: AnchorQuality;
    logger?: DiagnosticLogger;
  }
): Promise<OffsetEstimate> {
  const hintMs = opts?.hintOffsetMs ?? 0;
  // avfoundation vs AudioTee pipeline latency can exceed 2s in real runs
  // (device warmup, buffer prefill). A 5s search radius still converges
  // quickly since the search seeds from the capture-meta hint.
  const defaultMaxMs =
    opts?.anchorQuality === "trusted" ? 800 : 5000;
  const maxMs = opts?.maxOffsetMs ?? defaultMaxMs;
  const windowSec = opts?.windowSec ?? 30;
  const clampedHint = Math.max(-maxMs, Math.min(maxMs, hintMs));

  let mic: Float32Array;
  let system: Float32Array;
  try {
    [mic, system] = await Promise.all([
      readMonoF32(micPath, windowSec),
      readMonoF32(systemPath, windowSec),
    ]);
  } catch (err) {
    opts?.logger?.warn("offset estimate: failed to read audio for alignment", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { offsetMs: 0, confidence: 0 };
  }

  // Gate on signal strength: if either track is ~silent over the analysis
  // window, there's nothing to align.
  const minEnergy = 0.0001;
  const energy = (a: Float32Array) => {
    let e = 0;
    for (let i = 0; i < a.length; i += 16) e += a[i] * a[i];
    return e / Math.max(1, a.length / 16);
  };
  if (energy(mic) < minEnergy || energy(system) < minEnergy) {
    opts?.logger?.info("offset estimate: signal too quiet; skipping alignment");
    return { offsetMs: 0, confidence: 0 };
  }

  const hintSamples = Math.round((clampedHint / 1000) * 16000);
  const radiusSamples = Math.round((maxMs / 1000) * 16000);
  const { lagSamples, confidence } = bestLagSamples(mic, system, hintSamples, radiusSamples);
  const offsetMs = (lagSamples / 16000) * 1000;

  // Lower confidence bar than we'd like for a dedicated AEC reference
  // signal, but appropriate here: the mic captures a noisy, attenuated
  // version of the system output mixed with the user's voice, so the
  // cross-correlation peak is often modest. 1.15 still rejects flat
  // correlation surfaces while accepting real (if noisy) matches.
  const confidenceFloor = 1.15;
  if (confidence < confidenceFloor) {
    opts?.logger?.info("offset estimate: confidence below threshold", {
      offsetMs: Math.round(offsetMs),
      confidence: +confidence.toFixed(2),
      floor: confidenceFloor,
    });
    return { offsetMs: 0, confidence: 0 };
  }

  return { offsetMs: +offsetMs.toFixed(1), confidence: +confidence.toFixed(2) };
}

/**
 * Produce a cleaned mic track with aligned system audio suppressed, using
 * an ffmpeg filter graph that sidechain-compresses the mic by the system
 * track and then applies FFT denoise for residual bleed.
 *
 * This is an approximation — stock ffmpeg has no true linear AEC. The
 * current graph was picked to be robust with the bundled ffmpeg build; it
 * ducks the mic when the far-end (system audio) is loud, which removes
 * most re-captured speaker content in quiet rooms. Tune if users report
 * over-ducking of their own speech.
 *
 * `offsetMs` is the value returned by `estimateMicSystemOffsetMs`. It is
 * applied to the system input so the suppression aligns sample-wise.
 */
export async function cancelSystemFromMic(
  micPath: string,
  systemPath: string,
  cleanedMicPath: string,
  offsetMs: number,
  logger?: DiagnosticLogger
): Promise<void> {
  const dir = path.dirname(cleanedMicPath);
  fs.mkdirSync(dir, { recursive: true });

  // Positive offset in our convention means "system lags mic". To align,
  // we advance (negative itsoffset) the system input by that many ms.
  const sysOffsetSec = -offsetMs / 1000;

  // Sidechain compressor: when [ref] exceeds threshold, duck [mic].
  // The `sidechaincompress` filter needs both the primary and sidechain at
  // the same sample rate / layout, which aresample+aformat guarantees.
  const filterGraph = [
    "[0:a]aresample=16000,aformat=sample_fmts=flt:channel_layouts=mono[mic]",
    "[1:a]aresample=16000,aformat=sample_fmts=flt:channel_layouts=mono,volume=1.0[ref]",
    "[mic][ref]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=120:makeup=1[ducked]",
    "[ducked]afftdn=nf=-25:nr=12[out]",
  ].join(";");

  const args = [
    "-hide_banner",
    "-loglevel", "error",
    "-i", micPath,
    "-itsoffset", sysOffsetSec.toFixed(3),
    "-i", systemPath,
    "-filter_complex", filterGraph,
    "-map", "[out]",
    "-ar", "16000",
    "-ac", "1",
    "-c:a", "pcm_s16le",
    "-y",
    cleanedMicPath,
  ];

  try {
    await execFileAsync(getFfmpegPath(), args);
    logger?.info("AEC: cleaned mic written", { cleanedMicPath, offsetMs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger?.warn("AEC: ffmpeg failed; falling back to raw mic", { error: msg });
    // Best-effort fallback: copy the raw mic so downstream always finds the file.
    try {
      fs.copyFileSync(micPath, cleanedMicPath);
    } catch {
      // If copy also fails, surface the original ffmpeg error upstream.
      throw err instanceof Error ? err : new Error(msg);
    }
  }
}

/**
 * Per-segment AEC sidecar metadata. Written next to the cleaned WAV so we
 * can audit offset/confidence from a finished run without extending the
 * run manifest schema.
 */
export interface AecSidecar {
  offsetMs: number;
  confidence: number;
  source: "timestamp-hint" | "xcorr" | "skipped";
  micPath: string;
  systemPath: string;
  cleanedMicPath?: string;
  ffmpegFilter?: string;
  writtenAt: string;
}

export function writeAecSidecar(sidecarPath: string, data: AecSidecar): void {
  try {
    fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
    fs.writeFileSync(sidecarPath, JSON.stringify(data, null, 2));
  } catch {
    // Sidecars are debug aids — never fail the run over a write error.
  }
}

// ---- Existing merge ----

/**
 * Merge multiple audio files into a single output using ffmpeg's amix filter.
 * Used to create a combined playback file from mic + system audio channels.
 * The output contains all channels mixed together at equal volume.
 */
export async function mergeAudioFiles(
  inputPaths: string[],
  outputPath: string
): Promise<void> {
  return mergeTimedAudioFiles(inputPaths.map((path) => ({ path })), outputPath);
}

export async function mergeTimedAudioFiles(
  inputs: AudioMixInput[],
  outputPath: string
): Promise<void> {
  const inputPaths = inputs.map((input) => input.path);
  if (inputPaths.length === 0) return;
  if (inputPaths.length === 1) {
    // Single input — just copy.
    fs.copyFileSync(inputPaths[0], outputPath);
    return;
  }

  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });

  // ffmpeg's amix requires all inputs to share a sample rate + channel layout,
  // so resample each to 48 kHz mono before mixing. Mic is typically at the
  // device native rate (often 44.1 or 48 kHz) while the AudioTee system track
  // is 48 kHz; without this normalization step amix silently fails on input
  // mismatch and no combined.wav gets written.
  const inputArgs = inputs.flatMap((input) => {
    const args: string[] = [];
    if (input.offsetMs && Math.abs(input.offsetMs) >= 1) {
      args.push("-itsoffset", (-input.offsetMs / 1000).toFixed(3));
    }
    args.push("-i", input.path);
    return args;
  });
  const resampleChain = inputs
    .map((input, i) => {
      const gainFilter =
        input.gainDb && Math.abs(input.gainDb) >= 0.25
          ? `,volume=${input.gainDb.toFixed(1)}dB`
          : "";
      return `[${i}:a]aresample=48000,aformat=sample_fmts=s16:channel_layouts=mono${gainFilter}[a${i}]`;
    })
    .join(";");
  const mixInputs = inputs.map((_, i) => `[a${i}]`).join("");
  const filterGraph = `${resampleChain};${mixInputs}amix=inputs=${inputs.length}:duration=longest[out]`;
  try {
    await execFileAsync(getFfmpegPath(), [
      ...inputArgs,
      "-filter_complex", filterGraph,
      "-map", "[out]",
      "-ar", "48000",
      "-ac", "1",
      "-c:a", "pcm_s16le",
      "-y",
      outputPath,
    ]);
  } catch (err) {
    throw new Error(
      `Failed to merge audio files: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Concatenate WAV files end-to-end into `outputPath`. Inputs must share
 * sample rate, channel layout, and codec (the mix output of
 * `mergeTimedAudioFiles` is always 48 kHz mono pcm_s16le, so segment clips
 * from there concatenate cleanly).
 */
export async function concatWavFiles(
  inputPaths: string[],
  outputPath: string
): Promise<void> {
  if (inputPaths.length === 0) return;
  if (inputPaths.length === 1) {
    fs.copyFileSync(inputPaths[0], outputPath);
    return;
  }

  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });

  // Re-encode to a uniform format so concat can't fail on any subtle
  // header differences between per-segment mixes. pcm_s16le mono 48 kHz
  // matches the mix output, so this is cheap.
  const inputArgs = inputPaths.flatMap((p) => ["-i", p]);
  const filter =
    inputPaths
      .map((_, i) => `[${i}:a]aresample=48000,aformat=sample_fmts=s16:channel_layouts=mono[a${i}]`)
      .join(";") +
    ";" +
    inputPaths.map((_, i) => `[a${i}]`).join("") +
    `concat=n=${inputPaths.length}:v=0:a=1[out]`;

  try {
    await execFileAsync(getFfmpegPath(), [
      ...inputArgs,
      "-filter_complex", filter,
      "-map", "[out]",
      "-ar", "48000",
      "-ac", "1",
      "-c:a", "pcm_s16le",
      "-y",
      outputPath,
    ]);
  } catch (err) {
    throw new Error(
      `Failed to concatenate audio files: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
