import fs from "node:fs";
import path from "node:path";
import { AudioTee, type AudioChunk } from "audiotee";

/**
 * Crash-safe system audio recorder using AudioTee (CoreAudio taps, macOS 14.2+).
 *
 * Records raw PCM to a temporary `.raw` file during capture. On `stop()`,
 * finalizes to a proper WAV file. If the app crashes before stop, the
 * `.raw` file survives and can be recovered via `recoverRawFile()`.
 */

const RAW_SUFFIX = ".system-recording.raw";

interface AudioTeeSessionOptions {
  outputDir: string;
  sampleRate?: number;
  onError?: (error: Error) => void;
  /**
   * Absolute path to the audiotee binary. When the embedding app (Electron)
   * has bundled a patched copy of the binary inside its own app bundle so it
   * inherits the parent's TCC responsibility, pass that path here. If
   * omitted, AudioTee falls back to the stock `node_modules/audiotee/bin/audiotee`
   * binary, which on macOS is treated by TCC as its own app and silently
   * records zeros unless explicitly granted System Audio Recording permission.
   */
  binaryPath?: string;
}

export interface AudioTeeSession {
  /** True if AudioTee started successfully. */
  started: boolean;
  /** Path to the final system.wav (written on stop). */
  systemPath: string;
  /**
   * Wall-clock ms when the AudioTee capture call returned — used as a coarse
   * start-time hint for cross-correlation alignment between the mic and
   * system tracks. Only set when `started` is true.
   */
  startedAtMs?: number;
  /** Stop recording and finalize the WAV file. */
  stop(): Promise<void>;
}

/**
 * Start capturing system audio via AudioTee. Returns a session object.
 * If AudioTee fails to start (permission denied, macOS too old, binary
 * missing), `started` is false and `stop()` is a no-op.
 */
export async function startAudioTeeCapture(
  opts: AudioTeeSessionOptions
): Promise<AudioTeeSession> {
  const sampleRate = opts.sampleRate ?? 48000;
  const outputDir = opts.outputDir;
  const systemPath = path.join(outputDir, "system.wav");
  const rawPath = path.join(outputDir, RAW_SUFFIX);

  fs.mkdirSync(outputDir, { recursive: true });

  let tee: AudioTee;
  let writeStream: fs.WriteStream;
  let totalBytes = 0;
  let started = false;
  let stopped = false;
  let startedAtMs: number | undefined;

  try {
    tee = new AudioTee({ sampleRate, binaryPath: opts.binaryPath });
    writeStream = fs.createWriteStream(rawPath);

    tee.on("data", (chunk: AudioChunk) => {
      if (!stopped && chunk.data) {
        writeStream.write(chunk.data);
        totalBytes += chunk.data.length;
      }
    });

    tee.on("error", (err: Error) => {
      opts.onError?.(err);
    });

    await tee.start();
    started = true;
    startedAtMs = Date.now();
  } catch (err) {
    // Permission denied, binary not found, macOS too old, etc.
    opts.onError?.(err instanceof Error ? err : new Error(String(err)));
    return {
      started: false,
      systemPath,
      stop: async () => {},
    };
  }

  return {
    started,
    systemPath,
    startedAtMs,
    stop: async () => {
      if (stopped) return;
      stopped = true;

      try {
        await tee.stop();
      } catch {
        // Best effort — AudioTee may already be stopped.
      }

      // Close the write stream and wait for it to flush.
      await new Promise<void>((resolve, reject) => {
        writeStream.end(() => {
          writeStream.close((err) => (err ? reject(err) : resolve()));
        });
      });

      // Finalize: write WAV header + raw PCM data → system.wav
      if (totalBytes > 0) {
        finalizeRawToWav(rawPath, systemPath, sampleRate, totalBytes);
      }

      // Clean up the raw file.
      try {
        fs.unlinkSync(rawPath);
      } catch {
        // Already deleted or never created.
      }
    },
  };
}

/**
 * Convert a raw PCM file to a proper WAV file by prepending a header.
 * Reads the raw file and writes header + data to the output path atomically.
 */
function finalizeRawToWav(
  rawPath: string,
  wavPath: string,
  sampleRate: number,
  dataSize?: number
): void {
  const rawData = fs.readFileSync(rawPath);
  const actualSize = dataSize ?? rawData.length;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + actualSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM subchunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(actualSize, 40);

  // Write atomically: header + data to a temp file, then rename.
  const tmpPath = wavPath + ".tmp";
  const fd = fs.openSync(tmpPath, "w");
  fs.writeSync(fd, header);
  fs.writeSync(fd, rawData);
  fs.closeSync(fd);
  fs.renameSync(tmpPath, wavPath);
}

/**
 * Recover an interrupted recording from an orphaned .raw file.
 * Call this during app startup or run recovery to salvage partial
 * system audio captures from crashes.
 */
export function recoverRawFile(
  audioDir: string,
  sampleRate = 48000
): string | null {
  const entries = fs.readdirSync(audioDir);
  const rawFile = entries.find((e) => e.endsWith(RAW_SUFFIX));
  if (!rawFile) return null;

  const rawPath = path.join(audioDir, rawFile);
  const systemPath = path.join(audioDir, "system.wav");

  try {
    const stat = fs.statSync(rawPath);
    if (stat.size > 0) {
      finalizeRawToWav(rawPath, systemPath, sampleRate);
      fs.unlinkSync(rawPath);
      return systemPath;
    }
  } catch {
    // Corrupted or empty — clean up.
  }

  try {
    fs.unlinkSync(rawPath);
  } catch {
    // Ignore.
  }
  return null;
}
