#!/usr/bin/env node
/**
 * Remove prior-version arch artifacts from packages/app/release/ so the
 * notarize step can run against a clean directory.
 *
 * Why: build.mac.artifactName is now versionless (`Gistlist-arm64.dmg`),
 * but past versioned artifacts (`Gistlist-0.1.0-arm64.dmg`, etc.) stick
 * around in `release/` across version bumps. notarize-release.mjs aborts
 * if it sees multiple arch-matching candidates.
 *
 * Strategy:
 *  1. Read the current expected versionless filenames from package.json
 *     (productName) — `${productName}-${arch}.{dmg,zip}` plus blockmaps.
 *  2. Walk only the top level of release/ — leave the
 *     `release/mac-${arch}/` subdir alone (it's fully derivative; builder
 *     wipes it on next package).
 *  3. Allowlist: never touch `latest-mac.yml`, `builder-debug.yml`,
 *     `builder-effective-config.yaml`, `.DS_Store`, anything in
 *     `mac-${arch}/`, or the current expected names.
 *  4. Filter: only consider files matching `Gistlist-*-arm64.{dmg,zip}`
 *     plus their `.blockmap` siblings. The current expected names don't
 *     match this pattern (no `-*-` segment between productName and arch),
 *     so they're never candidates for deletion — defense in depth on top
 *     of the allowlist.
 *
 * Logs every file deleted with `[clean-release-arch] removed: <name>`.
 * Exits 0 even when there's nothing to clean.
 */

import { readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_PKG_ROOT = path.resolve(__dirname, "..");

const pkg = JSON.parse(
  readFileSync(path.join(APP_PKG_ROOT, "package.json"), "utf8")
);

const productName = pkg.build?.productName ?? pkg.productName ?? "Gistlist";
const archs = ["arm64", "x64"]; // we only ship arm64 today, but be future-proof
const releaseDir = path.join(APP_PKG_ROOT, "release");

function expectedNamesFor(arch) {
  return new Set([
    `${productName}-${arch}.dmg`,
    `${productName}-${arch}.dmg.blockmap`,
    `${productName}-${arch}-mac.zip`,
    `${productName}-${arch}-mac.zip.blockmap`,
  ]);
}

const allowlist = new Set([
  "latest-mac.yml",
  "builder-debug.yml",
  "builder-effective-config.yaml",
  ".DS_Store",
]);
for (const arch of archs) {
  for (const name of expectedNamesFor(arch)) allowlist.add(name);
}

// Pattern: Gistlist-<anything>-<arch>.{dmg,zip,blockmap}
// Note the literal `-` after Gistlist and before the arch — the
// versionless `Gistlist-arm64.dmg` does NOT match (no middle segment).
function isStaleCandidate(name) {
  for (const arch of archs) {
    const re = new RegExp(
      `^${productName}-.+-${arch}(?:-mac)?\\.(?:dmg|zip)(?:\\.blockmap)?$`
    );
    if (re.test(name)) return true;
  }
  return false;
}

function main() {
  let stat;
  try {
    stat = statSync(releaseDir);
  } catch {
    console.log(`[clean-release-arch] no release dir at ${releaseDir} — nothing to clean`);
    return;
  }
  if (!stat.isDirectory()) {
    console.error(`[clean-release-arch] ${releaseDir} is not a directory`);
    process.exit(1);
  }

  const entries = readdirSync(releaseDir, { withFileTypes: true });
  let removed = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) continue; // leaves mac-${arch}/ etc untouched
    if (allowlist.has(entry.name)) continue;
    if (!isStaleCandidate(entry.name)) continue;
    const full = path.join(releaseDir, entry.name);
    try {
      unlinkSync(full);
      console.log(`[clean-release-arch] removed: ${entry.name}`);
      removed += 1;
    } catch (err) {
      console.error(
        `[clean-release-arch] failed to remove ${entry.name}: ${err instanceof Error ? err.message : String(err)}`
      );
      process.exit(1);
    }
  }
  console.log(`[clean-release-arch] removed ${removed} stale artifact(s)`);
}

main();
