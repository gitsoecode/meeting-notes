import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

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
    const { stderr } = await execFileAsync("ffmpeg", [
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
    const child = spawn("ffmpeg", [
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
    logger?: DiagnosticLogger;
  }
): Promise<OffsetEstimate> {
  const hintMs = opts?.hintOffsetMs ?? 0;
  // avfoundation vs AudioTee pipeline latency can exceed 2s in real runs
  // (device warmup, buffer prefill). A 5s search radius still converges
  // quickly since the search seeds from the capture-meta hint.
  const maxMs = opts?.maxOffsetMs ?? 5000;
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
    await execFileAsync("ffmpeg", args);
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
  const inputArgs = inputPaths.flatMap((p) => ["-i", p]);
  const resampleChain = inputPaths
    .map((_, i) => `[${i}:a]aresample=48000,aformat=sample_fmts=s16:channel_layouts=mono[a${i}]`)
    .join(";");
  const mixInputs = inputPaths.map((_, i) => `[a${i}]`).join("");
  const filterGraph = `${resampleChain};${mixInputs}amix=inputs=${inputPaths.length}:duration=longest[out]`;
  try {
    await execFileAsync("ffmpeg", [
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
