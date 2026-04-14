#!/usr/bin/env node
// Build the `mic-capture` helper binary from `native/mic-capture.swift`.
//
// Output path: `resources/bin/mic-capture` (picked up by electron-builder
// extraResources and resolved at runtime via `app/main/mic-capture-binary.ts`).
//
// We compile with `-O` (optimize) and as a universal binary (arm64 +
// x86_64) so the same `.app` runs on both Apple Silicon and Intel Macs.
// Requires Xcode or the Command Line Tools. Skips silently on non-macOS
// so CI can build the rest of the app on Linux without failing here.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const src = path.join(appRoot, "native", "mic-capture.swift");
const outDir = path.join(appRoot, "resources", "bin");
const outBin = path.join(outDir, "mic-capture");

if (process.platform !== "darwin") {
  console.log(`[build-mic-capture] skipped (platform=${process.platform}, macOS-only)`);
  process.exit(0);
}

if (!fs.existsSync(src)) {
  console.error(`[build-mic-capture] missing source: ${src}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

const args = [
  "-O",
  // Universal binary so the same .app runs on both architectures.
  "-target", "arm64-apple-macos12.0",
  "-target", "x86_64-apple-macos12.0",
  "-o", outBin,
  src,
];

// swiftc doesn't support multi-`-target`; build each arch, lipo together.
function compileArch(arch) {
  const out = outBin + "." + arch;
  const res = spawnSync("swiftc", [
    "-O",
    "-target", `${arch}-apple-macos12.0`,
    "-o", out,
    src,
  ], { stdio: "inherit" });
  if (res.status !== 0) {
    console.error(`[build-mic-capture] swiftc failed for ${arch}`);
    process.exit(res.status ?? 1);
  }
  return out;
}

const arm = compileArch("arm64");
const x86 = compileArch("x86_64");

const lipo = spawnSync("lipo", ["-create", "-output", outBin, arm, x86], {
  stdio: "inherit",
});
if (lipo.status !== 0) {
  console.error("[build-mic-capture] lipo failed");
  process.exit(lipo.status ?? 1);
}

// Clean up per-arch intermediates.
for (const p of [arm, x86]) {
  try { fs.unlinkSync(p); } catch {}
}

// Make executable (should already be).
fs.chmodSync(outBin, 0o755);

// Verify.
const size = fs.statSync(outBin).size;
console.log(`[build-mic-capture] built ${outBin} (${(size / 1024).toFixed(0)} KB, universal)`);
