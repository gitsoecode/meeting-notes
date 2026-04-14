#!/usr/bin/env node
// Launch Electron via LaunchServices (`open -a`) — the same mechanism the
// dev launcher uses — to test whether the "System Audio Recording Only"
// TCC grant reaches the audiotee helper. Exits 0 on granted, 2 on denied,
// 1 on other errors.
//
// IMPORTANT: This MUST use `open -a`, not Node's `child_process.spawn`.
// Terminal-spawned Electron inherits TCC responsibility from the terminal
// emulator, not Electron itself, so it would always report "denied" even
// when the Electron bundle has been granted permission.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const ELECTRON_APP = path.join(
  repoRoot,
  "node_modules",
  "electron",
  "dist",
  "Electron.app"
);
const AUDIOTEE_PKG = path.join(repoRoot, "node_modules", "audiotee");
const RESULT_FILE = "/tmp/audiotee-electron-result.json";
const TEST_APP_DIR = "/tmp/audiotee-test-app";

const MAIN_CJS = `
const { app } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { AudioTee } = require(${JSON.stringify(AUDIOTEE_PKG)});
const RESULT_FILE = ${JSON.stringify(RESULT_FILE)};

async function run() {
  await app.whenReady();
  const state = { totalBytes: 0, totalSamples: 0, zeroSamples: 0, peakSq: 0 };
  const bundledAudiotee = path.resolve(process.execPath, "..", "audiotee");
  const tee = new AudioTee({ sampleRate: 16000, binaryPath: bundledAudiotee });
  tee.on("data", (chunk) => {
    if (!chunk.data) return;
    state.totalBytes += chunk.data.length;
    const len = chunk.data.length - (chunk.data.length % 2);
    for (let i = 0; i < len; i += 2) {
      let s = chunk.data[i] | (chunk.data[i + 1] << 8);
      if (s & 0x8000) s |= ~0xffff;
      if (s === 0) state.zeroSamples += 1;
      state.totalSamples += 1;
      const sq = s * s;
      if (sq > state.peakSq) state.peakSq = sq;
    }
  });
  tee.on("error", (err) => {
    fs.writeFileSync(RESULT_FILE, JSON.stringify({ status: "error", error: err.message }));
  });
  try { await tee.start(); }
  catch (e) {
    fs.writeFileSync(RESULT_FILE, JSON.stringify({ status: "start-failed", error: e.message }));
    app.exit(1);
    return;
  }

  // Play audio so there's something to capture.
  spawn("/usr/bin/afplay", ["/System/Library/Sounds/Glass.aiff"], { stdio: "ignore" });
  setTimeout(() => spawn("/usr/bin/say", ["one two three four five"], { stdio: "ignore" }), 1200);

  setTimeout(async () => {
    try { await tee.stop(); } catch {}
    const granted = state.totalSamples >= 4000 && state.zeroSamples < state.totalSamples;
    const result = {
      bundledAudiotee,
      totalBytes: state.totalBytes,
      totalSamples: state.totalSamples,
      zeroSamples: state.zeroSamples,
      peakAmplitude: Math.sqrt(state.peakSq),
      nonZeroPct: state.totalSamples > 0
        ? ((100 * (state.totalSamples - state.zeroSamples)) / state.totalSamples).toFixed(2) + "%"
        : "0%",
      status: granted ? "granted" : "denied",
    };
    fs.writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2));
    app.exit(granted ? 0 : 2);
  }, 5000);
}

run().catch((err) => {
  try { fs.writeFileSync(RESULT_FILE, JSON.stringify({ status: "crash", error: String(err) })); } catch {}
  app.exit(1);
});
`;

function setUpTestApp() {
  fs.mkdirSync(TEST_APP_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(TEST_APP_DIR, "package.json"),
    JSON.stringify({ name: "audiotee-test", version: "0.0.1", main: "main.cjs" })
  );
  fs.writeFileSync(path.join(TEST_APP_DIR, "main.cjs"), MAIN_CJS);
}

async function main() {
  try { fs.unlinkSync(RESULT_FILE); } catch {}
  setUpTestApp();

  const args = ["-n", "-W", "-a", ELECTRON_APP, "--args", TEST_APP_DIR];
  const child = spawn("open", args, { cwd: repoRoot, stdio: "inherit", env: process.env });
  await new Promise((resolve) => child.on("exit", resolve));

  if (!fs.existsSync(RESULT_FILE)) {
    console.error("[test-audiotee-in-electron] no result file written — Electron may have crashed");
    process.exit(1);
  }
  const result = fs.readFileSync(RESULT_FILE, "utf8");
  console.log("[ELECTRON_TEST_RESULT]", result);
  const parsed = JSON.parse(result);
  process.exit(parsed.status === "granted" ? 0 : parsed.status === "denied" ? 2 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
