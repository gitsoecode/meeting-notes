import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig, saveConfig, getConfigDir } from "./config.js";
import { getFfmpegPath } from "./ffmpeg-path.js";
import { getPythonPath } from "./python-path.js";

const execFileAsync = promisify(execFile);

// Pinned version for reproducibility. Bump deliberately.
const MLX_AUDIO_VERSION = "0.4.2";
const DEFAULT_MODEL = "mlx-community/parakeet-tdt-0.6b-v2";
const STAMP_FILE = "version.json";

interface VenvStamp {
  pythonVersion: string;
  mlxAudioVersion: string;
}

export interface SetupAsrOptions {
  force?: boolean;
  /**
   * Called with human-readable progress lines. The CLI wires this to
   * stdout; the Electron app streams it into a log pane. When omitted,
   * nothing is printed.
   */
  onLog?: (line: string) => void;
  /**
   * Cancellation. Aborting mid-install kills the child process and the
   * caller is expected to clean up partial venv state via the same
   * `.prev` rescue pattern used inside this module.
   */
  abort?: AbortSignal;
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
  onLog?: (line: string) => void,
  abort?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    onLog?.(`  $ ${label}`);
    const child = spawn(cmd, args, {
      stdio: onLog ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
    });
    if (onLog) streamChildOutput(child, onLog);
    const onAbort = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already exited */
      }
    };
    if (abort) {
      if (abort.aborted) onAbort();
      else abort.addEventListener("abort", onAbort, { once: true });
    }
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (abort) abort.removeEventListener("abort", onAbort);
      if (abort?.aborted) {
        reject(new Error("aborted"));
        return;
      }
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with code ${code ?? signal}`));
    });
  });
}

async function resolvePython(): Promise<string> {
  // Prefer the host-injected absolute path (Electron sets this after
  // resolving the app-managed Python runtime via its own resolver).
  // Falls through to PATH lookup for CLI/dev usage.
  const injected = getPythonPath();
  if (injected !== "python3" && fs.existsSync(injected)) return injected;
  const candidates = ["python3.12", "python3.11", "python3"];
  for (const c of candidates) {
    const found = await which(c);
    if (found) return found;
  }
  throw new Error(
    "Python 3 not found. Run setup again from the app (Settings → Run setup again → Dependencies) to install an app-managed Python runtime."
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
      "ffmpeg not found (needed to generate the smoke-test audio file). " +
      "Install ffmpeg from the setup wizard (Settings → Run setup again → Dependencies)."
    );
  }
  return found;
}

async function pythonVersionString(python: string): Promise<string> {
  const { stdout, stderr } = await execFileAsync(python, ["-V"]);
  // CPython prints to stdout on 3.4+, but historically used stderr.
  return (stdout || stderr).trim();
}

function readStamp(venv: string): VenvStamp | null {
  const stampPath = path.join(venv, STAMP_FILE);
  if (!fs.existsSync(stampPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(stampPath, "utf-8"));
    if (
      typeof parsed?.pythonVersion === "string" &&
      typeof parsed?.mlxAudioVersion === "string"
    ) {
      return parsed as VenvStamp;
    }
  } catch {
    /* malformed stamp — treat as absent */
  }
  return null;
}

function writeStamp(venv: string, stamp: VenvStamp): void {
  fs.writeFileSync(
    path.join(venv, STAMP_FILE),
    JSON.stringify(stamp, null, 2),
    "utf-8"
  );
}

/**
 * Safely rebuild the venv. Renames the old venv aside, builds the new
 * one, and either deletes the backup on success or restores it on
 * failure. Mirrors the `.prev` rescue pattern in download.ts. The user
 * is never left without a working venv if one existed before.
 */
async function rebuildVenvSafely(
  python: string,
  venv: string,
  expected: VenvStamp,
  onLog: ((s: string) => void) | undefined,
  abort: AbortSignal | undefined,
  build: () => Promise<void>
): Promise<void> {
  const backup = `${venv}.prev`;
  let backupCreated = false;
  // Crash-recovery: if a previous run was killed between rename-aside
  // and the canonical-venv being fully created, we'd see `.prev`
  // existing while the canonical is missing — that's the user's only
  // working venv, so restore it before proceeding (otherwise the
  // "delete stale .prev at start" logic below would destroy the only
  // known-good copy and weaken the "never left without a working venv"
  // guarantee). Only when both exist do we treat `.prev` as truly
  // stale (the previous run completed the new build but got killed
  // before the cleanup) — discard `.prev` then.
  if (fs.existsSync(backup) && !fs.existsSync(venv)) {
    onLog?.(`  Recovering venv from previous interrupted rebuild`);
    fs.renameSync(backup, venv);
  }
  if (fs.existsSync(backup)) {
    fs.rmSync(backup, { recursive: true, force: true });
  }
  if (fs.existsSync(venv)) {
    onLog?.(`  Saving existing venv aside: ${backup}`);
    fs.renameSync(venv, backup);
    backupCreated = true;
  }
  try {
    fs.mkdirSync(path.dirname(venv), { recursive: true });
    onLog?.(`  Creating venv: ${venv}`);
    await runStreaming(python, ["-m", "venv", venv], `${python} -m venv ${venv}`, onLog, abort);
    await build();
    writeStamp(venv, expected);
    if (backupCreated) {
      onLog?.(`  ✓ Rebuild succeeded — removing backup`);
      fs.rmSync(backup, { recursive: true, force: true });
    }
  } catch (err) {
    // Restore the backup so the user keeps a working ASR install if
    // they had one. New venv (if partially created) gets removed.
    if (fs.existsSync(venv)) {
      fs.rmSync(venv, { recursive: true, force: true });
    }
    if (backupCreated) {
      onLog?.(`  ✘ Rebuild failed — restoring previous venv`);
      fs.renameSync(backup, venv);
    }
    throw err;
  }
}

export async function setupAsr(opts: SetupAsrOptions = {}): Promise<void> {
  const { onLog, abort } = opts;
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

  // 2. Verify prerequisites. Both can be set by the Electron host via
  // setPythonPath/setFfmpegPath; the engine doesn't need to know how
  // they got resolved.
  const python = await resolvePython();
  log(`  ✓ Python:  ${python}`);
  const ffmpeg = await ensureFfmpeg();
  log(`  ✓ ffmpeg:  ${ffmpeg}`);

  const pythonVersion = await pythonVersionString(python);
  const expectedStamp: VenvStamp = {
    pythonVersion,
    mlxAudioVersion: MLX_AUDIO_VERSION,
  };

  // 3. Decide whether to reuse, rebuild, or fresh-build the venv. Force
  // wins; otherwise compare the stamp to (python, mlx-audio) and rebuild
  // if it doesn't match — venvs built against an old Python can't be
  // safely reused if the runtime version bumped.
  const venv = venvDir();
  const existingStamp = fs.existsSync(venv) ? readStamp(venv) : null;
  const stampMatches =
    existingStamp !== null &&
    existingStamp.pythonVersion === expectedStamp.pythonVersion &&
    existingStamp.mlxAudioVersion === expectedStamp.mlxAudioVersion;

  const needsRebuild = opts.force || !stampMatches;
  if (needsRebuild && fs.existsSync(venv)) {
    if (opts.force) {
      log(`  Force flag set — rebuilding venv`);
    } else {
      log(`  Venv stamp does not match expected (python=${expectedStamp.pythonVersion}, mlx-audio=${expectedStamp.mlxAudioVersion}) — rebuilding`);
    }
  }

  const parakeetBin = venvBin("mlx_audio.stt.generate");

  const runSmokeTest = async () => {
    if (!fs.existsSync(parakeetBin)) {
      throw new Error(
        `Expected binary not found after install: ${parakeetBin}\n` +
        "Something went wrong with pip install mlx-audio."
      );
    }
    log(`\n  ✓ Installed: ${parakeetBin}`);
    log("\n  Running smoke test (downloads Parakeet weights on first run, ~600 MB)...");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gistlist-setup-"));
    const aiffPath = path.join(tmpDir, "speech.aiff");
    const wavPath = path.join(tmpDir, "speech.wav");
    const outBase = path.join(tmpDir, "out");
    try {
      // Both `say` and the ffmpeg conversion are short (<5 s each on
      // first invocation, milliseconds afterward) but they still need
      // an abort path for the case where the user cancels mid-chain
      // while one of them is mid-run. Without `signal:` here, an
      // abort() during the ffmpeg conversion would let the process run
      // to completion before the abort surfaced.
      const execOpts = abort ? { signal: abort } : {};
      await execFileAsync("say", ["-v", "Alex", "-o", aiffPath, "Parakeet smoke test is working."], execOpts);
      await execFileAsync(ffmpeg, ["-i", aiffPath, "-ar", "16000", "-ac", "1", wavPath, "-y"], execOpts);
      await runStreaming(
        parakeetBin,
        ["--model", DEFAULT_MODEL, "--audio", wavPath, "--output-path", outBase, "--format", "json"],
        `mlx_audio.stt.generate --model ${DEFAULT_MODEL} --audio <wav> --output-path <out> --format json`,
        onLog,
        abort
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
  };

  // The build callback ALSO runs the smoke test before returning. This
  // is the safety guarantee: rebuildVenvSafely's `.prev` rescue only
  // commits (writes the stamp + deletes .prev) if `build()` resolves
  // successfully. By including the smoke test here, a model-weight
  // download or transcription failure causes the old working venv to
  // be restored — not just the pip install step.
  const buildVenvContents = async () => {
    const venvPython = venvBin("python");
    const venvPip = venvBin("pip");
    log("\n  Upgrading pip...");
    await runStreaming(
      venvPython,
      ["-m", "pip", "install", "--upgrade", "pip"],
      "pip install --upgrade pip",
      onLog,
      abort
    );
    log(`\n  Installing mlx-audio==${MLX_AUDIO_VERSION}...`);
    await runStreaming(
      venvPip,
      ["install", `mlx-audio==${MLX_AUDIO_VERSION}`],
      `pip install mlx-audio==${MLX_AUDIO_VERSION}`,
      onLog,
      abort
    );
    await runSmokeTest();
  };

  if (needsRebuild) {
    await rebuildVenvSafely(python, venv, expectedStamp, onLog, abort, buildVenvContents);
  } else {
    log(`  ✓ Venv exists and stamp matches: ${venv}`);
    // Verify the entry-point still exists. Skip the full smoke test —
    // the stamp guarantees a prior install passed it.
    if (!fs.existsSync(parakeetBin)) {
      throw new Error(
        `Expected binary not found in stamped venv: ${parakeetBin}\n` +
        "The venv may have been corrupted. Re-run with force: true to rebuild."
      );
    }
    log(`  ✓ Installed: ${parakeetBin}`);
  }

  // 6. Persist config — skipped if no config exists yet (the setup wizard
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
