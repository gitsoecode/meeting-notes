#!/usr/bin/env node
/**
 * Submit the already-signed macOS artifacts for notarization, staple the
 * accepted ticket onto every artifact, and rebuild the release zip from
 * the stapled .app.
 *
 * electron-builder v25 notarizes inside its signing step, before the
 * `afterSign` hook runs. Gistlist's `afterSign` hook must re-sign
 * Contents/MacOS/audiotee with `com.apple.security.inherit` and re-seal
 * the bundle, so notarization lives here instead — after electron-builder
 * signs, after our hook repairs AudioTee, and before the release zip is
 * considered final.
 *
 * What we submit, and why:
 *
 * Apple's notary ticket service is keyed by the SHA-256 of each binary
 * it inspects, not by submission. When you submit a .dmg, Apple unpacks
 * it, validates and notarizes the dmg AND every binary inside (the .app,
 * its helpers, audiotee, etc.) — and registers a ticket for each hash.
 * Stapling then works for the .dmg AND for the standalone .app at
 * release/mac-arm64/Gistlist.app, because the standalone .app is
 * byte-identical to the .app inside the dmg, so they share a hash.
 *
 * Submitting the .app directly (as we used to) only registers tickets
 * for the .app and its inner binaries. The .dmg's hash isn't on file,
 * and `stapler staple foo.dmg` fails with "Record not found".
 *
 * If no .dmg exists (e.g. someone temporarily drops dmg from the build
 * targets), fall back to submitting the .app. Stapling the .app still
 * works in that case; the dmg-staple step just becomes a no-op.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_PKG_ROOT = path.resolve(__dirname, "..");

const pkg = JSON.parse(
  fs.readFileSync(path.join(APP_PKG_ROOT, "package.json"), "utf8")
);

const productName = pkg.build?.productName ?? "Gistlist";
const version = pkg.version;
const arch = process.env.GISTLIST_RELEASE_ARCH ?? "arm64";
const keychainProfile =
  process.env.APPLE_KEYCHAIN_PROFILE ?? "gistlist-notary";

const releaseDir = path.join(APP_PKG_ROOT, "release");
const macOutDir = path.join(releaseDir, `mac-${arch}`);
const appName = `${productName}.app`;
const appPath = path.join(macOutDir, appName);
const appSubmitZip = path.join(
  os.tmpdir(),
  `${productName}-${version}-${arch}-notary-submit.zip`
);

/**
 * Find the .dmg/.zip electron-builder produced for the current build.
 *
 * Strategy:
 *   1. If a file matching the *exact* `expectedName` exists in `dir`,
 *      return it. This is the happy path for versionless artifact
 *      naming (`Gistlist-arm64.dmg`) and survives stale artifacts from
 *      prior version bumps still sitting in `release/`.
 *   2. Otherwise fall back to a single arch-matching file. Errors out
 *      if more than one matches — the prior bug was that this fallback
 *      ran unconditionally and aborted whenever a previous version's
 *      artifact was still present.
 */
function findSingleArtifact(dir, ext, archMarker, expectedName) {
  const exactPath = path.join(dir, expectedName);
  if (fs.existsSync(exactPath)) return exactPath;

  const matches = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(`.${ext}`) && name.includes(archMarker));
  if (matches.length > 1) {
    throw new Error(
      `[notarize-release] expected ${expectedName} in ${dir}, didn't find it, ` +
        `and saw multiple .${ext} candidates for arch ${archMarker}: ${matches.join(", ")}. ` +
        `Run scripts/clean-release-arch.mjs to remove stale artifacts before retrying.`
    );
  }
  return matches[0] ? path.join(dir, matches[0]) : null;
}

function log(message) {
  console.log(`[notarize-release] ${message}`);
}

function run(command, args, options = {}) {
  log(`${command} ${args.join(" ")}`);
  execFileSync(command, args, {
    cwd: options.cwd ?? APP_PKG_ROOT,
    stdio: "inherit",
  });
}

function read(command, args, options = {}) {
  log(`${command} ${args.join(" ")}`);
  return execFileSync(command, args, {
    cwd: options.cwd ?? APP_PKG_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

if (!fs.existsSync(appPath)) {
  throw new Error(`[notarize-release] missing app bundle: ${appPath}`);
}

// Versionless artifact names from build.mac.artifactName. If the build
// config ever flips back to versioned names, the exact-match fast path
// will simply miss and the glob fallback takes over.
const expectedDmgName = `${productName}-${arch}.dmg`;
const expectedZipName = `${productName}-${arch}-mac.zip`;
const dmgPath = findSingleArtifact(releaseDir, "dmg", arch, expectedDmgName);
const builtZipPath = findSingleArtifact(releaseDir, "zip", arch, expectedZipName);

let submitTarget;
let submitTargetLabel;
if (dmgPath) {
  submitTarget = dmgPath;
  submitTargetLabel = `dmg ${path.basename(dmgPath)}`;
} else {
  log(`no .dmg in ${releaseDir}; falling back to .app submission`);
  // ditto-zip the .app for upload — notarytool wants .zip/.dmg/.pkg.
  run(
    "ditto",
    ["-c", "-k", "--keepParent", "--sequesterRsrc", appName, appSubmitZip],
    { cwd: macOutDir }
  );
  submitTarget = appSubmitZip;
  submitTargetLabel = `app (zipped) ${appName}`;
}

let submissionId = process.env.GISTLIST_NOTARY_SUBMISSION_ID;

if (submissionId) {
  log(`resuming existing notary submission ${submissionId}`);
} else {
  log(`submitting ${submitTargetLabel} with keychain profile "${keychainProfile}"`);
  const submitJson = read("xcrun", [
    "notarytool",
    "submit",
    submitTarget,
    "--keychain-profile",
    keychainProfile,
    "--output-format",
    "json",
  ]);
  const submitted = JSON.parse(submitJson);
  submissionId = submitted.id;
  if (!submissionId) {
    throw new Error(`[notarize-release] notarytool did not return an id: ${submitJson}`);
  }
  log(`submission id: ${submissionId}`);
}

let status = "In Progress";
let lastError = null;
while (status === "In Progress") {
  try {
    const infoJson = read("xcrun", [
      "notarytool",
      "info",
      submissionId,
      "--keychain-profile",
      keychainProfile,
      "--output-format",
      "json",
    ]);
    const info = JSON.parse(infoJson);
    status = info.status;
    lastError = null;
    log(`notarization status: ${status}`);
  } catch (err) {
    lastError = err;
    log(`status check failed; retrying in 60s: ${err.stderr?.toString() || err.message}`);
  }

  if (status === "In Progress") sleep(60_000);
}

if (status !== "Accepted") {
  try {
    run("xcrun", [
      "notarytool",
      "log",
      submissionId,
      "--keychain-profile",
      keychainProfile,
    ]);
  } catch (err) {
    log(`failed to fetch notary log: ${err.message}`);
  }
  throw new Error(
    `[notarize-release] notarization ended with status ${status}` +
      (lastError ? `; last status error: ${lastError.message}` : "")
  );
}

// Staple the .app first. Works whether we submitted the .dmg (the .app's
// hash was registered too) or submitted the .app directly.
run("xcrun", ["stapler", "staple", appPath]);
run("xcrun", ["stapler", "validate", appPath]);

if (dmgPath) {
  log(`stapling ${dmgPath}`);
  run("xcrun", ["stapler", "staple", dmgPath]);
  run("xcrun", ["stapler", "validate", dmgPath]);
}

// Overwrite the .zip electron-builder produced (which contains the
// pre-staple .app) with one ditto'd from the now-stapled .app. Path is
// whatever electron-builder's artifactName template emitted.
if (builtZipPath) {
  log(`rebuilding stapled release zip at ${builtZipPath}`);
  run(
    "ditto",
    ["-c", "-k", "--keepParent", "--sequesterRsrc", appName, builtZipPath],
    { cwd: macOutDir }
  );
} else {
  log("no .zip in release/ — skipping zip rebuild");
}

log("notarization, stapling, and release zip rebuild complete");
