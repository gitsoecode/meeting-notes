#!/usr/bin/env node
/**
 * Regenerate `release/latest-mac.yml` against the on-disk dmg + zip after
 * notarize-release.mjs staples them and rebuilds the zip.
 *
 * Why this exists: electron-builder writes `latest-mac.yml` BEFORE the
 * notarize step. After we staple the dmg and rebuild the zip from the
 * newly-stapled .app, both artifacts have different bytes — and therefore
 * different sha512 + size — than the manifest claims. If we publish the
 * stale manifest, electron-updater on every existing user's machine
 * downloads the new zip, hashes it, sees the mismatch, and aborts.
 *
 * That's silent auto-update breakage. v0.1.1 dodged it (no prior users on
 * an auto-updating build), but we hit the wall at v0.1.2 → v0.1.N.
 *
 * Strategy:
 *  - Read the current YAML (just the parts we care about).
 *  - Recompute sha512 (base64) + byte-size for the zip and dmg.
 *  - Rewrite the file in place. We don't pull in a YAML parser — the
 *    structure is fixed by electron-builder and trivial to regex-replace.
 */

import { readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_PKG_ROOT = path.resolve(__dirname, "..");
const releaseDir = path.join(APP_PKG_ROOT, "release");

function sha512Base64(filePath) {
  const buf = readFileSync(filePath);
  return createHash("sha512").update(buf).digest("base64");
}

function fileMeta(filePath) {
  return {
    sha512: sha512Base64(filePath),
    size: statSync(filePath).size,
  };
}

const ymlPath = path.join(releaseDir, "latest-mac.yml");
const zipPath = path.join(releaseDir, "Gistlist-arm64.zip");
const dmgPath = path.join(releaseDir, "Gistlist-arm64.dmg");

const zipMeta = fileMeta(zipPath);
const dmgMeta = fileMeta(dmgPath);

let yml = readFileSync(ymlPath, "utf8");

// Replace the zip entry's sha512 + size. Anchored on the zip url line so
// we don't accidentally hit the dmg block.
yml = yml.replace(
  /(- url: Gistlist-arm64\.zip\s+sha512:)\s+\S+(\s+size:)\s+\d+/,
  `$1 ${zipMeta.sha512}$2 ${zipMeta.size}`
);

// Same for the dmg entry.
yml = yml.replace(
  /(- url: Gistlist-arm64\.dmg\s+sha512:)\s+\S+(\s+size:)\s+\d+/,
  `$1 ${dmgMeta.sha512}$2 ${dmgMeta.size}`
);

// Top-level sha512 mirrors the primary (zip) artifact.
yml = yml.replace(/^sha512:\s+\S+$/m, `sha512: ${zipMeta.sha512}`);

writeFileSync(ymlPath, yml, "utf8");

console.log(`[regen-latest-mac-yml] regenerated ${ymlPath}`);
console.log(`[regen-latest-mac-yml]   zip: ${zipMeta.size} bytes, sha512=${zipMeta.sha512.slice(0, 16)}…`);
console.log(`[regen-latest-mac-yml]   dmg: ${dmgMeta.size} bytes, sha512=${dmgMeta.sha512.slice(0, 16)}…`);
