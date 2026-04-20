#!/usr/bin/env node
// Patch the audiotee helper binary so it actually captures system audio.
//
// Why this is needed (macOS TCC mechanics):
//   * macOS 14.2+ requires the "System Audio Recording Only" permission for
//     any process that taps system audio via Core Audio.
//   * TCC identifies apps by their *responsible process* — usually the
//     immediate parent launched via LaunchServices.
//   * The audiotee binary from npm is ad-hoc signed with its own identifier.
//     When spawned by Electron in dev, macOS treats audiotee as its own app
//     (not a child of Electron), so granting permission to "Electron" has no
//     effect on audiotee's TCC lookups. Result: AudioTee silently streams
//     zero bytes.
//
// What this script does:
//   1. Copies the audiotee binary *inside* the running Electron.app bundle
//      (Electron.app/Contents/MacOS/audiotee) so macOS can see it as part of
//      the parent bundle.
//   2. Re-signs it ad-hoc with the com.apple.security.inherit entitlement so
//      macOS attributes its TCC requests to the responsible process (Electron
//      in dev, Gistlist in a packaged build).
//
// Run manually: node packages/app/scripts/patch-audiotee.mjs
// Runs automatically after `npm install` (via the app's postinstall hook) and
// as part of `npm run rebuild:native`.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appPkgRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appPkgRoot, "..", "..");

const AUDIOTEE_SRC = path.join(repoRoot, "node_modules", "audiotee", "bin", "audiotee");
const ELECTRON_APP = path.join(repoRoot, "node_modules", "electron", "dist", "Electron.app");
const ELECTRON_MACOS = path.join(ELECTRON_APP, "Contents", "MacOS");
const BUNDLED_AUDIOTEE = path.join(ELECTRON_MACOS, "audiotee");
const ENTITLEMENTS = path.join(appPkgRoot, "resources", "audiotee-inherit.entitlements");

function log(msg) {
  process.stderr.write(`[patch-audiotee] ${msg}\n`);
}

if (process.platform !== "darwin") {
  log("not macOS — nothing to patch");
  process.exit(0);
}

if (!fs.existsSync(AUDIOTEE_SRC)) {
  log(`audiotee binary not found at ${AUDIOTEE_SRC} — skipping (is audiotee installed?)`);
  process.exit(0);
}
if (!fs.existsSync(ELECTRON_APP)) {
  log(`Electron.app not found at ${ELECTRON_APP} — skipping (is electron installed?)`);
  process.exit(0);
}
if (!fs.existsSync(ENTITLEMENTS)) {
  log(`entitlements file not found at ${ENTITLEMENTS} — aborting`);
  process.exit(1);
}

try {
  fs.copyFileSync(AUDIOTEE_SRC, BUNDLED_AUDIOTEE);
  fs.chmodSync(BUNDLED_AUDIOTEE, 0o755);
  log(`copied audiotee into ${BUNDLED_AUDIOTEE}`);
} catch (err) {
  log(`failed to copy audiotee: ${err.message}`);
  process.exit(1);
}

try {
  execSync(
    `codesign --force --sign - --entitlements ${JSON.stringify(ENTITLEMENTS)} ${JSON.stringify(BUNDLED_AUDIOTEE)}`,
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  log("re-signed audiotee with com.apple.security.inherit entitlement");
} catch (err) {
  log(`codesign failed: ${err.message}`);
  process.exit(1);
}

log("patch complete");
