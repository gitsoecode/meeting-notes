import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pingOllama, getConfigDir, createAppLogger } from "@gistlist/engine";
import { resolveBin } from "./bundled.js";
import { trackChildProcess, updateTrackedProcess } from "./activity-monitor.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const PING_INTERVAL_MS = 250;
// First-run cold start on a slow disk (or with macOS Gatekeeper doing a
// first-launch verification on the freshly-installed binary) can exceed
// 8s. 20s leaves headroom without making genuine failure modes feel slow.
const PING_TIMEOUT_MS = 20000;

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
 *   2. App-installed binary at `<userData>/bin/ollama` — landed by the
 *      wizard installer (Phase 2). Preferred when present because we
 *      know its version and SHA-256.
 *   3. Bundled inside the .app (legacy) — kept so dev builds with locally-
 *      staged binaries still resolve.
 *   4. System `ollama` on PATH — the user's existing Homebrew install.
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

  // 2-4. resolveBin walks app-installed → bundled → system in priority order.
  const resolved = await resolveBin("ollama");
  if (!resolved) {
    throw new Error(
      "No Ollama binary available — wizard install hasn't run, nothing bundled, nothing on PATH."
    );
  }
  const binary: string = resolved.path;
  // The OllamaSource enum predates the resolver split; both "app-installed"
  // and "bundled" map to "bundled-spawned" because to the daemon's lifecycle
  // they're identical (we own it, we kill it on quit). "system" maps to
  // "system-spawned" — the user's binary, but we run it.
  const source: OllamaSource =
    resolved.source === "system" ? "system-spawned" : "bundled-spawned";

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
      `Check ~/.gistlist/ollama.log for details.`
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

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
