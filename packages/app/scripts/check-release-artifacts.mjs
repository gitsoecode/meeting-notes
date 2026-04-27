#!/usr/bin/env node
/**
 * Post-build/notarize gate that asserts the on-disk release artifacts
 * actually contain what we promised:
 *
 *   - main app + audiotee entitlements (the v0.1.1–v0.1.3 mic-entitlement
 *     bug shipped because nobody checked these on the signed bundle)
 *   - signed bundle still verifies after stapling (codesign --verify)
 *   - Info.plist CFBundleShortVersionString matches package.json.version
 *   - latest-mac.yml hashes/sizes match the on-disk dmg/zip
 *   - latest-mac.yml top-level version matches package.json.version
 *
 * Runs at the end of `package:mac:sign`, after notarize-release.mjs
 * staples the artifacts and regenerates latest-mac.yml. If any check
 * fails this script exits non-zero and the release pipeline halts —
 * tag/publish never happen.
 *
 * Inner check helpers are exported so tests can exercise them against
 * fixtures without spawning real codesign / plutil. Set
 * GISTLIST_RELEASE_DIR to point the CLI at a fixture tree.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_PKG_ROOT = path.resolve(__dirname, "..");

const REQUIRED_MAIN_ENTITLEMENTS = [
  "com.apple.security.device.audio-input",
  "com.apple.security.cs.allow-jit",
  "com.apple.security.cs.allow-unsigned-executable-memory",
  "com.apple.security.cs.disable-library-validation",
];

const REQUIRED_AUDIOTEE_ENTITLEMENTS = ["com.apple.security.inherit"];

export class ReleaseCheckError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReleaseCheckError";
  }
}

/**
 * Convert plist XML/binary text into a parsed JSON object via `plutil`.
 * Pure-ish helper: takes XML text, writes it to a temp file, shells out
 * to plutil, parses JSON, cleans up. The temp-file dance avoids stdin
 * quirks across macOS versions.
 */
export function parsePlistJson(plistText) {
  const tmpPath = path.join(
    os.tmpdir(),
    `gistlist-plist-${randomBytes(6).toString("hex")}.plist`
  );
  fs.writeFileSync(tmpPath, plistText);
  try {
    const json = execFileSync("plutil", ["-convert", "json", "-o", "-", tmpPath], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    return JSON.parse(json);
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch {}
  }
}

/**
 * Pure: given a parsed entitlements JSON object, assert each required
 * key is present and set to true. Throws ReleaseCheckError on miss.
 */
export function assertEntitlementsPresent(entitlements, requiredKeys, label) {
  if (!entitlements || typeof entitlements !== "object") {
    throw new ReleaseCheckError(
      `[${label}] entitlements payload is not an object: ${JSON.stringify(entitlements)}`
    );
  }
  const missing = [];
  const wrongValue = [];
  for (const key of requiredKeys) {
    if (!(key in entitlements)) {
      missing.push(key);
    } else if (entitlements[key] !== true) {
      wrongValue.push(`${key}=${JSON.stringify(entitlements[key])}`);
    }
  }
  if (missing.length || wrongValue.length) {
    const parts = [];
    if (missing.length) parts.push(`missing: ${missing.join(", ")}`);
    if (wrongValue.length) parts.push(`not-true: ${wrongValue.join(", ")}`);
    throw new ReleaseCheckError(
      `[${label}] entitlement assertion failed — ${parts.join("; ")}. ` +
        `present keys: ${Object.keys(entitlements).join(", ") || "(none)"}`
    );
  }
}

/**
 * Pure: compute base64 sha512 of a file. Same algorithm
 * regen-latest-mac-yml.mjs uses, so the manifest hashes match.
 */
export function sha512Base64(filePath) {
  const buf = fs.readFileSync(filePath);
  return createHash("sha512").update(buf).digest("base64");
}

/**
 * Pure: parse latest-mac.yml text and validate every entry under
 * `files:` against on-disk reality. Also asserts top-level version.
 */
export function checkManifest(manifestText, releaseDir, expectedVersion) {
  let parsed;
  try {
    parsed = YAML.parse(manifestText);
  } catch (err) {
    throw new ReleaseCheckError(
      `[manifest] failed to parse latest-mac.yml: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new ReleaseCheckError(`[manifest] latest-mac.yml parsed to non-object: ${typeof parsed}`);
  }
  if (parsed.version !== expectedVersion) {
    throw new ReleaseCheckError(
      `[manifest] top-level version mismatch — expected ${expectedVersion}, got ${parsed.version}`
    );
  }
  if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
    throw new ReleaseCheckError(`[manifest] latest-mac.yml has no files: entries`);
  }
  for (const entry of parsed.files) {
    if (!entry || typeof entry !== "object") {
      throw new ReleaseCheckError(`[manifest] malformed files: entry: ${JSON.stringify(entry)}`);
    }
    const { url, sha512, size } = entry;
    if (typeof url !== "string" || !url) {
      throw new ReleaseCheckError(`[manifest] files: entry missing url: ${JSON.stringify(entry)}`);
    }
    const onDisk = path.join(releaseDir, url);
    if (!fs.existsSync(onDisk)) {
      throw new ReleaseCheckError(
        `[manifest] file referenced by manifest does not exist on disk: ${onDisk}`
      );
    }
    const actualSize = fs.statSync(onDisk).size;
    if (actualSize !== size) {
      throw new ReleaseCheckError(
        `[manifest] size mismatch for ${url} — manifest says ${size}, disk has ${actualSize}`
      );
    }
    const actualHash = sha512Base64(onDisk);
    if (actualHash !== sha512) {
      throw new ReleaseCheckError(
        `[manifest] sha512 mismatch for ${url} — manifest says ${sha512}, disk has ${actualHash}`
      );
    }
  }
}

/**
 * Read entitlements from a Mach-O binary on disk. Uses codesign with the
 * --xml flag (writes raw XML, no blob-wrapper header) to a temp file, then
 * converts via plutil. Returns the parsed JSON object.
 *
 * Not exported as a "pure" helper — this is the one piece that talks to
 * codesign + plutil. Tests should call assertEntitlementsPresent with
 * fixture JSON instead of going through this.
 */
export function readEntitlementsJson(binaryPath) {
  const tmpXml = path.join(
    os.tmpdir(),
    `gistlist-ent-${randomBytes(6).toString("hex")}.xml`
  );
  try {
    execFileSync(
      "codesign",
      ["-d", "--entitlements", tmpXml, "--xml", binaryPath],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    const xml = fs.readFileSync(tmpXml, "utf8");
    return parsePlistJson(xml);
  } finally {
    try {
      fs.unlinkSync(tmpXml);
    } catch {}
  }
}

/**
 * Run codesign --verify on the bundle. Throws ReleaseCheckError with the
 * full codesign output (stdout + stderr) on failure. Entitlement presence
 * is meaningless if the signature itself is invalid.
 */
export function verifyCodeSignature(appPath) {
  try {
    execFileSync(
      "codesign",
      ["--verify", "--deep", "--strict", "--verbose=2", appPath],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch (err) {
    const stdout = err.stdout?.toString?.() ?? "";
    const stderr = err.stderr?.toString?.() ?? "";
    throw new ReleaseCheckError(
      `[codesign] --verify --deep --strict failed for ${appPath}\n` +
        `stdout: ${stdout}\nstderr: ${stderr}`
    );
  }
}

/**
 * Read CFBundleShortVersionString from an Info.plist via plutil.
 */
export function readBundleShortVersion(infoPlistPath) {
  if (!fs.existsSync(infoPlistPath)) {
    throw new ReleaseCheckError(`[version] Info.plist not found: ${infoPlistPath}`);
  }
  const plistText = fs.readFileSync(infoPlistPath, "utf8");
  const parsed = parsePlistJson(plistText);
  const v = parsed?.CFBundleShortVersionString;
  if (typeof v !== "string") {
    throw new ReleaseCheckError(
      `[version] CFBundleShortVersionString missing or not a string in ${infoPlistPath}`
    );
  }
  return v;
}

/**
 * Top-level orchestrator. Reads expected values from package.json, walks
 * the release directory, runs every check. Throws on the first failure
 * or returns a report object on success.
 *
 * Options:
 *   releaseDir       — defaults to GISTLIST_RELEASE_DIR or <pkg>/release
 *   arch             — defaults to GISTLIST_RELEASE_ARCH or "arm64"
 *   pkgJsonPath      — defaults to <pkg>/package.json
 *   readEntitlements — injectable for tests; default is the live codesign reader
 *   verifySignature  — injectable for tests; default is the live codesign verifier
 *   readVersion      — injectable for tests; default reads Info.plist via plutil
 */
export function runChecks({
  releaseDir,
  arch,
  pkgJsonPath,
  readEntitlements = readEntitlementsJson,
  verifySignature = verifyCodeSignature,
  readVersion = readBundleShortVersion,
} = {}) {
  const resolvedReleaseDir =
    releaseDir ??
    process.env.GISTLIST_RELEASE_DIR ??
    path.join(APP_PKG_ROOT, "release");
  const resolvedArch = arch ?? process.env.GISTLIST_RELEASE_ARCH ?? "arm64";
  const resolvedPkgJsonPath = pkgJsonPath ?? path.join(APP_PKG_ROOT, "package.json");

  const pkg = JSON.parse(fs.readFileSync(resolvedPkgJsonPath, "utf8"));
  const expectedVersion = pkg.version;
  const productName = pkg.build?.productName ?? "Gistlist";

  if (!expectedVersion) {
    throw new ReleaseCheckError(`[setup] package.json has no version field`);
  }

  const macOutDir = path.join(resolvedReleaseDir, `mac-${resolvedArch}`);
  const appPath = path.join(macOutDir, `${productName}.app`);
  const infoPlistPath = path.join(appPath, "Contents", "Info.plist");
  const mainBinary = path.join(appPath, "Contents", "MacOS", productName);
  const audioteeBinary = path.join(appPath, "Contents", "MacOS", "audiotee");
  const manifestPath = path.join(resolvedReleaseDir, "latest-mac.yml");

  for (const required of [appPath, mainBinary, audioteeBinary, manifestPath]) {
    if (!fs.existsSync(required)) {
      throw new ReleaseCheckError(`[setup] expected path missing: ${required}`);
    }
  }

  const actualVersion = readVersion(infoPlistPath);
  if (actualVersion !== expectedVersion) {
    throw new ReleaseCheckError(
      `[version] CFBundleShortVersionString mismatch — expected ${expectedVersion}, got ${actualVersion} (${infoPlistPath})`
    );
  }

  verifySignature(appPath);

  const mainEnts = readEntitlements(mainBinary);
  assertEntitlementsPresent(mainEnts, REQUIRED_MAIN_ENTITLEMENTS, "main-app");

  const audioteeEnts = readEntitlements(audioteeBinary);
  assertEntitlementsPresent(audioteeEnts, REQUIRED_AUDIOTEE_ENTITLEMENTS, "audiotee");

  const manifestText = fs.readFileSync(manifestPath, "utf8");
  checkManifest(manifestText, resolvedReleaseDir, expectedVersion);

  return {
    releaseDir: resolvedReleaseDir,
    arch: resolvedArch,
    productName,
    version: expectedVersion,
  };
}

// CLI shim
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const report = runChecks();
    console.log(
      `[check-release-artifacts] PASS — ${report.productName} ${report.version} (${report.arch}) at ${report.releaseDir}`
    );
  } catch (err) {
    if (err instanceof ReleaseCheckError) {
      console.error(`[check-release-artifacts] FAIL — ${err.message}`);
      process.exit(1);
    }
    console.error(`[check-release-artifacts] unexpected error:`, err);
    process.exit(2);
  }
}
