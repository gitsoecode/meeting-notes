import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig, saveConfig, getConfigDir } from "./config.js";
import { getFfmpegPath } from "./ffmpeg-path.js";

const execFileAsync = promisify(execFile);

// Pinned version for reproducibility. Bump deliberately.
const MLX_AUDIO_VERSION = "0.4.2";
const DEFAULT_MODEL = "mlx-community/parakeet-tdt-0.6b-v2";

export interface SetupAsrOptions {
  force?: boolean;
  /**
   * Called with human-readable progress lines. The CLI wires this to
   * stdout; the Electron app streams it into a log pane. When omitted,
   * nothing is printed.
   */
  onLog?: (line: string) => void;
}

function venvDir(): string {
  return path.join(getConfigDir(), "parakeet-venv");
}

function venvBin(name: string): string {
  return path.join(venvDir(), "bin", name);
}

async function which(cmd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("/usr/bin/env", ["which", cmd]);
    const trimmed = stdout.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

function streamChildOutput(
  child: ReturnType<typeof spawn>,
  onLog?: (line: string) => void
): void {
  if (!onLog) return;
  const forward = (chunk: Buffer) => {
    const text = chunk.toString("utf-8");
    for (const line of text.split(/\r?\n/)) {
      if (line.length > 0) onLog(line);
    }
  };
  child.stdout?.on("data", forward);
  child.stderr?.on("data", forward);
}

async function runStreaming(
  cmd: string,
  args: string[],
  label: string,
  onLog?: (line: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    onLog?.(`  $ ${label}`);
    const child = spawn(cmd, args, {
      stdio: onLog ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
    });
    if (onLog) streamChildOutput(child, onLog);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with code ${code}`));
    });
  });
}

async function findPython3(): Promise<string> {
  // Prefer a stable version: python3.12 > python3.11 > python3
  const candidates = ["python3.12", "python3.11", "python3"];
  for (const c of candidates) {
    const found = await which(c);
    if (found) return found;
  }
  throw new Error(
    "python3 not found. Install it first:\n" +
    "  brew install python@3.12"
  );
}

async function ensureFfmpeg(): Promise<string> {
  // Prefer the host-injected absolute path (Electron sets this after
  // resolving via its own resolver). Falls through to PATH lookup for
  // standalone CLI usage.
  const injected = getFfmpegPath();
  if (injected !== "ffmpeg" && fs.existsSync(injected)) return injected;
  const found = await which("ffmpeg");
  if (!found) {
    throw new Error(
      "ffmpeg not found (needed to generate the smoke-test audio file).\n" +
      "Install with: brew install ffmpeg"
    );
  }
  return found;
}

export async function setupAsr(opts: SetupAsrOptions = {}): Promise<void> {
  const { onLog } = opts;
  const log = (msg: string) => onLog?.(msg);
  log("\n  Gistlist — ASR setup (Parakeet via mlx-audio)\n");

  // 1. Load config — may not exist yet if invoked from the setup wizard
  // before "Finish setup" runs. Persist step below is skipped in that case.
  let config: Awaited<ReturnType<typeof loadConfig>> | null = null;
  try {
    config = loadConfig();
  } catch {
    config = null;
  }

  // 2. Verify prerequisites
  const python = await findPython3();
  log(`  ✓ Python:  ${python}`);
  const ffmpeg = await ensureFfmpeg();
  log(`  ✓ ffmpeg:  ${ffmpeg}`);

  // 3. Create venv (or reuse)
  const venv = venvDir();
  if (opts.force && fs.existsSync(venv)) {
    log(`  Removing existing venv: ${venv}`);
    fs.rmSync(venv, { recursive: true, force: true });
  }
  if (!fs.existsSync(venv)) {
    fs.mkdirSync(path.dirname(venv), { recursive: true });
    log(`  Creating venv: ${venv}`);
    await runStreaming(python, ["-m", "venv", venv], `${python} -m venv ${venv}`, onLog);
  } else {
    log(`  ✓ Venv exists: ${venv}`);
  }

  const venvPython = venvBin("python");
  const venvPip = venvBin("pip");

  // 4. Upgrade pip
  log("\n  Upgrading pip...");
  await runStreaming(
    venvPython,
    ["-m", "pip", "install", "--upgrade", "pip"],
    "pip install --upgrade pip",
    onLog
  );

  // 5. Install mlx-audio at pinned version
  log(`\n  Installing mlx-audio==${MLX_AUDIO_VERSION}...`);
  await runStreaming(
    venvPip,
    ["install", `mlx-audio==${MLX_AUDIO_VERSION}`],
    `pip install mlx-audio==${MLX_AUDIO_VERSION}`,
    onLog
  );

  // 6. Verify the entry-point exists
  const parakeetBin = venvBin("mlx_audio.stt.generate");
  if (!fs.existsSync(parakeetBin)) {
    throw new Error(
      `Expected binary not found after install: ${parakeetBin}\n` +
      "Something went wrong with pip install mlx-audio."
    );
  }
  log(`\n  ✓ Installed: ${parakeetBin}`);

  // 7. Smoke test — generate 3s of TTS audio and transcribe it
  log("\n  Running smoke test (generates TTS audio + transcribes)...");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gistlist-setup-"));
  const aiffPath = path.join(tmpDir, "speech.aiff");
  const wavPath = path.join(tmpDir, "speech.wav");
  const outBase = path.join(tmpDir, "out");

  try {
    // Generate speech with macOS `say`
    await execFileAsync("say", ["-v", "Alex", "-o", aiffPath, "Parakeet smoke test is working."]);
    // Convert to 16kHz mono wav
    await execFileAsync(ffmpeg, ["-i", aiffPath, "-ar", "16000", "-ac", "1", wavPath, "-y"]);

    // Run transcription
    await runStreaming(
      parakeetBin,
      ["--model", DEFAULT_MODEL, "--audio", wavPath, "--output-path", outBase, "--format", "json"],
      `mlx_audio.stt.generate --model ${DEFAULT_MODEL} --audio <wav> --output-path <out> --format json`,
      onLog
    );

    const jsonPath = `${outBase}.json`;
    if (!fs.existsSync(jsonPath)) {
      throw new Error(`Smoke test failed: no JSON output produced at ${jsonPath}`);
    }
    const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    if (!parsed.text || typeof parsed.text !== "string") {
      throw new Error(`Smoke test produced invalid JSON (no 'text' field): ${JSON.stringify(parsed).slice(0, 200)}`);
    }
    log(`\n  ✓ Smoke test transcription: "${parsed.text.trim()}"`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // 8. Persist config — skipped if no config exists yet (the setup wizard
  // will write the full config on its Finish step using the same provider
  // and binary path).
  if (config) {
    config.asr_provider = "parakeet-mlx";
    config.parakeet_mlx = {
      binary_path: parakeetBin,
      model: DEFAULT_MODEL,
    };
    saveConfig(config);
    log("\n  ✓ Parakeet ready. Config updated.");
  } else {
    log("\n  ✓ Parakeet ready. Config will be written on Finish.");
  }
  log(`    asr_provider: parakeet-mlx`);
  log(`    binary:       ${parakeetBin}`);
  log(`    model:        ${DEFAULT_MODEL}\n`);
}
