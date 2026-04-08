import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig, saveConfig, getConfigDir } from "./config.js";

const execFileAsync = promisify(execFile);

// Pinned version for reproducibility. Bump deliberately.
const MLX_AUDIO_VERSION = "0.4.2";
const DEFAULT_MODEL = "mlx-community/parakeet-tdt-0.6b-v2";

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

async function runStreaming(cmd: string, args: string[], label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`  $ ${label}`);
    const child = spawn(cmd, args, { stdio: ["ignore", "inherit", "inherit"] });
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
  const found = await which("ffmpeg");
  if (!found) {
    throw new Error(
      "ffmpeg not found (needed to generate the smoke-test audio file).\n" +
      "Install with: brew install ffmpeg"
    );
  }
  return found;
}

export async function setupAsr(opts: { force?: boolean } = {}): Promise<void> {
  console.log("\n  Meeting Notes — ASR setup (Parakeet via mlx-audio)\n");

  // 1. Load config (or start from defaults if not initialized yet)
  let config;
  try {
    config = loadConfig();
  } catch {
    throw new Error(
      "Config not found. Run 'meeting-notes init' first, then 'meeting-notes setup-asr'."
    );
  }

  // 2. Verify prerequisites
  const python = await findPython3();
  console.log(`  ✓ Python:  ${python}`);
  const ffmpeg = await ensureFfmpeg();
  console.log(`  ✓ ffmpeg:  ${ffmpeg}`);

  // 3. Create venv (or reuse)
  const venv = venvDir();
  if (opts.force && fs.existsSync(venv)) {
    console.log(`  Removing existing venv: ${venv}`);
    fs.rmSync(venv, { recursive: true, force: true });
  }
  if (!fs.existsSync(venv)) {
    fs.mkdirSync(path.dirname(venv), { recursive: true });
    console.log(`  Creating venv: ${venv}`);
    await runStreaming(python, ["-m", "venv", venv], `${python} -m venv ${venv}`);
  } else {
    console.log(`  ✓ Venv exists: ${venv}`);
  }

  const venvPython = venvBin("python");
  const venvPip = venvBin("pip");

  // 4. Upgrade pip
  console.log("\n  Upgrading pip...");
  await runStreaming(
    venvPython,
    ["-m", "pip", "install", "--upgrade", "pip"],
    "pip install --upgrade pip"
  );

  // 5. Install mlx-audio at pinned version
  console.log(`\n  Installing mlx-audio==${MLX_AUDIO_VERSION}...`);
  await runStreaming(
    venvPip,
    ["install", `mlx-audio==${MLX_AUDIO_VERSION}`],
    `pip install mlx-audio==${MLX_AUDIO_VERSION}`
  );

  // 6. Verify the entry-point exists
  const parakeetBin = venvBin("mlx_audio.stt.generate");
  if (!fs.existsSync(parakeetBin)) {
    throw new Error(
      `Expected binary not found after install: ${parakeetBin}\n` +
      "Something went wrong with pip install mlx-audio."
    );
  }
  console.log(`\n  ✓ Installed: ${parakeetBin}`);

  // 7. Smoke test — generate 3s of TTS audio and transcribe it
  console.log("\n  Running smoke test (generates TTS audio + transcribes)...");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meeting-notes-setup-"));
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
      `mlx_audio.stt.generate --model ${DEFAULT_MODEL} --audio <wav> --output-path <out> --format json`
    );

    const jsonPath = `${outBase}.json`;
    if (!fs.existsSync(jsonPath)) {
      throw new Error(`Smoke test failed: no JSON output produced at ${jsonPath}`);
    }
    const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    if (!parsed.text || typeof parsed.text !== "string") {
      throw new Error(`Smoke test produced invalid JSON (no 'text' field): ${JSON.stringify(parsed).slice(0, 200)}`);
    }
    console.log(`\n  ✓ Smoke test transcription: "${parsed.text.trim()}"`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // 8. Persist config
  config.asr_provider = "parakeet-mlx";
  config.parakeet_mlx = {
    binary_path: parakeetBin,
    model: DEFAULT_MODEL,
  };
  saveConfig(config);

  console.log("\n  ✓ Parakeet ready. Config updated.");
  console.log(`    asr_provider: parakeet-mlx`);
  console.log(`    binary:       ${parakeetBin}`);
  console.log(`    model:        ${DEFAULT_MODEL}\n`);
}
