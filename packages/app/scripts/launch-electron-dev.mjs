#!/usr/bin/env node
// Launch Electron via LaunchServices (`open -a`) instead of spawning it as a
// child of the terminal shell. This is critical on macOS: TCC attributes
// permission requests to the *responsible process*, which for a terminal-
// spawned child is the terminal itself — not Electron. The user's "Electron"
// grant in "System Audio Recording Only" is never consulted and AudioTee
// silently records zero bytes.
//
// `open -a` uses LaunchServices to launch Electron as the top-level
// responsible process, so its own TCC state (including the System Audio
// Recording Only grant the user set up) is the one macOS checks.
//
// Environment variables are passed through via `open --env`.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appPkgRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appPkgRoot, "..", "..");

const ELECTRON_APP = path.join(repoRoot, "node_modules", "electron", "dist", "Electron.app");

// Wait for the Vite dev server and compiled main/preload to be present before
// launching (matches the old `wait-on tcp:5173 dist/main/index.js
// dist/preload/index.js` behavior).
async function waitForPort(port, hostname = "127.0.0.1", timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.connect({ host: hostname, port });
        socket.once("connect", () => {
          socket.destroy();
          resolve();
        });
        socket.once("error", reject);
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error(`timed out waiting for ${hostname}:${port}`);
}

async function waitForFile(filePath, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timed out waiting for ${filePath}`);
}

async function main() {
  console.log("[launch-electron-dev] waiting for Vite + TypeScript compile…");
  await Promise.all([
    waitForPort(5173),
    waitForFile(path.join(appPkgRoot, "dist", "main", "index.js")),
    waitForFile(path.join(appPkgRoot, "dist", "preload", "index.js")),
  ]);
  console.log("[launch-electron-dev] launching Electron via LaunchServices (open -a)…");

  // --new: always launch a fresh instance (don't activate a running one)
  // --wait-apps: keep `open` running until the app quits (so concurrently sees
  //              the process live; stopping dev kills Electron)
  // --args: everything after this is forwarded to the app
  // --env: pass env vars via LaunchServices so the main process sees them
  const args = [
    "-n",
    "-W",
    "-a", ELECTRON_APP,
    "--env", "VITE_DEV_SERVER_URL=http://127.0.0.1:5173",
    "--env", "NODE_ENV=development",
    "--env", "ELECTRON_ENABLE_LOGGING=1",
    "--args",
    appPkgRoot, // Electron's entrypoint = path to the app directory (package.json)
  ];

  const child = spawn("open", args, {
    cwd: appPkgRoot,
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error("[launch-electron-dev] failed:", err.message);
  process.exit(1);
});
