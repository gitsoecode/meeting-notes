import { spawn, type ChildProcess, execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { pingOllama, getConfigDir, createAppLogger } from "@meeting-notes/engine";
import { bundledBin, bundledBinExists } from "./bundled.js";
import { trackChildProcess, updateTrackedProcess } from "./activity-monitor.js";

const execFileAsync = promisify(execFile);

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const PING_INTERVAL_MS = 250;
const PING_TIMEOUT_MS = 8000;

export type OllamaSource = "system-running" | "system-spawned" | "bundled-spawned";

export interface OllamaState {
  source: OllamaSource;
  baseUrl: string;
  pid?: number;
}

let state: OllamaState | null = null;
let child: ChildProcess | null = null;
let logStream: fs.WriteStream | null = null;
let trackedProcessId: string | null = null;
const appLogger = createAppLogger(false);

/**
 * Start (or reuse) an Ollama daemon and return where it lives. Resolution
 * order, top-down:
 *
 *   1. A daemon already answering on :11434 — leave it alone, just use it.
 *   2. A system `ollama` binary on PATH — spawn it ourselves and stop it
 *      on app quit. The user gets to keep their own model directory.
 *   3. The bundled binary inside the .app — spawn it. Models still default
 *      to ~/.ollama/models so a future system install picks them up.
 *
 * In every case OLLAMA_MODELS is left at the standard location so we
 * never duplicate downloads — the win the user explicitly asked for.
 */
export async function ensureOllamaDaemon(): Promise<OllamaState> {
  if (state) return state;

  // 1. Already running?
  if (await pingOllama(DEFAULT_BASE_URL)) {
    state = { source: "system-running", baseUrl: DEFAULT_BASE_URL };
    return state;
  }

  // 2. System binary on PATH?
  const systemPath = await whichOllama();

  // 3. Otherwise the bundled binary.
  let binary: string | null = systemPath;
  let source: OllamaSource = "system-spawned";
  if (!binary && bundledBinExists("ollama")) {
    binary = bundledBin("ollama");
    source = "bundled-spawned";
  }
  if (!binary) {
    throw new Error(
      "No Ollama binary available — neither installed on PATH nor bundled with the app."
    );
  }

  // Open log file early so spawn errors get captured too.
  fs.mkdirSync(getConfigDir(), { recursive: true });
  logStream = fs.createWriteStream(path.join(getConfigDir(), "ollama.log"), {
    flags: "a",
  });
  logStream.write(`\n--- ollama serve started at ${new Date().toISOString()} ---\n`);

  child = spawn(binary, ["serve"], {
    env: {
      ...process.env,
      // Don't override OLLAMA_HOST — default localhost is fine and we want to
      // share the standard port with anything else the user might run.
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  trackedProcessId = trackChildProcess(child, {
    type: "ollama-daemon",
    label: "Ollama daemon",
    command: `${binary} serve`,
  });
  appLogger.info("Starting Ollama daemon", {
    processType: "ollama-daemon",
    pid: child.pid,
    detail: source,
  });
  child.stdout?.on("data", (chunk: Buffer) => logStream?.write(chunk));
  child.stderr?.on("data", (chunk: Buffer) => logStream?.write(chunk));
  child.on("exit", (code, signal) => {
    logStream?.write(`\n--- ollama serve exited code=${code} signal=${signal} ---\n`);
    const payload = {
      processType: "ollama-daemon",
      pid: child?.pid,
      detail: signal ?? (code != null ? `code=${code}` : undefined),
    };
    if (code === 0) {
      appLogger.info("Ollama daemon exited", payload);
    } else {
      appLogger.error("Ollama daemon exited", payload);
    }
  });

  // Poll for readiness
  const start = Date.now();
  while (Date.now() - start < PING_TIMEOUT_MS) {
    if (await pingOllama(DEFAULT_BASE_URL)) {
      if (trackedProcessId) {
        updateTrackedProcess(trackedProcessId, { status: "running" });
      }
      appLogger.info("Ollama daemon ready", {
        processType: "ollama-daemon",
        pid: child.pid,
        detail: source,
      });
      state = { source, baseUrl: DEFAULT_BASE_URL, pid: child.pid };
      return state;
    }
    await delay(PING_INTERVAL_MS);
  }

  // Failed to come up — kill the child so we don't leak it.
  try {
    child?.kill("SIGTERM");
  } catch {
    // best effort
  }
  child = null;
  trackedProcessId = null;
  throw new Error(
    `Ollama daemon failed to start within ${PING_TIMEOUT_MS}ms. ` +
      `Check ~/.meeting-notes/ollama.log for details.`
  );
}

/**
 * Stop the daemon if (and only if) we started it. Reused-system daemons
 * are left running. Safe to call multiple times.
 */
export async function stopOllamaDaemon(): Promise<void> {
  if (!state || state.source === "system-running") {
    state = null;
    return;
  }
  if (child && !child.killed) {
    try {
      child.kill("SIGTERM");
    } catch {
      // best effort
    }
  }
  child = null;
  trackedProcessId = null;
  logStream?.end();
  logStream = null;
  state = null;
}

export function getOllamaState(): OllamaState | null {
  return state;
}

async function whichOllama(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("/usr/bin/env", ["which", "ollama"]);
    const trimmed = stdout.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
