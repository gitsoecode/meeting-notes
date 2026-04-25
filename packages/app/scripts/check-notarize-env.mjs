#!/usr/bin/env node
/**
 * Notarization preflight.
 *
 * Run automatically by `npm run package:mac -- --sign` (when that flag
 * is present in argv). Exits non-zero with a clear message before
 * electron-builder starts, so the user doesn't waste minutes on a
 * notarization round-trip when their credentials aren't reachable.
 *
 * Checks (any failure aborts):
 *   1. APPLE_API_KEY is set and points at an existing readable file.
 *   2. APPLE_API_KEY_ID is set (10-char alphanumeric).
 *   3. APPLE_API_ISSUER is set (UUID-shaped).
 *   4. `security find-identity -v -p codesigning` lists at least one
 *      "Developer ID Application" certificate.
 *
 * The user keeps the .p8 file outside the repo (recommended path:
 * ~/.gistlist-secrets/AuthKey_*.p8). See docs/beta-release-checklist.md.
 *
 * Local unsigned builds skip this script entirely — the package:mac
 * script only invokes it when --sign is present.
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";

let failed = false;

function fail(message) {
  console.error(`[check-notarize-env] ✘ ${message}`);
  failed = true;
}

function pass(message) {
  console.log(`[check-notarize-env] ✓ ${message}`);
}

// 1. APPLE_API_KEY (path to .p8)
const apiKeyPath = process.env.APPLE_API_KEY;
if (!apiKeyPath) {
  fail("APPLE_API_KEY is not set (export it before running --sign).");
} else if (!fs.existsSync(apiKeyPath)) {
  fail(`APPLE_API_KEY points to ${apiKeyPath}, which does not exist.`);
} else {
  try {
    fs.accessSync(apiKeyPath, fs.constants.R_OK);
    pass(`APPLE_API_KEY exists and is readable (${apiKeyPath})`);
  } catch {
    fail(
      `APPLE_API_KEY at ${apiKeyPath} is not readable — check permissions (chmod 600 is recommended).`
    );
  }
  if (!apiKeyPath.endsWith(".p8")) {
    console.warn(
      `[check-notarize-env] ⚠ APPLE_API_KEY does not end in .p8 — Apple's keys are AuthKey_<id>.p8. Continuing anyway.`
    );
  }
}

// 2. APPLE_API_KEY_ID
const apiKeyId = process.env.APPLE_API_KEY_ID;
if (!apiKeyId) {
  fail("APPLE_API_KEY_ID is not set.");
} else if (!/^[A-Z0-9]{10}$/.test(apiKeyId)) {
  fail(
    `APPLE_API_KEY_ID looks malformed: "${apiKeyId}" (expected 10 uppercase alphanumeric chars).`
  );
} else {
  pass(`APPLE_API_KEY_ID has the expected shape (${apiKeyId})`);
}

// 3. APPLE_API_ISSUER (UUID)
const issuer = process.env.APPLE_API_ISSUER;
const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!issuer) {
  fail("APPLE_API_ISSUER is not set.");
} else if (!uuidRe.test(issuer)) {
  fail(
    `APPLE_API_ISSUER looks malformed: "${issuer}" (expected UUID like xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).`
  );
} else {
  pass("APPLE_API_ISSUER has the expected UUID shape");
}

// 4. Developer ID Application cert in keychain
try {
  const out = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], {
    encoding: "utf-8",
  });
  if (/Developer ID Application/i.test(out)) {
    const match = out.match(/Developer ID Application:.+?\(.+?\)/);
    pass(`Developer ID Application cert found${match ? ` (${match[0]})` : ""}`);
  } else {
    fail(
      "No 'Developer ID Application' certificate in your login keychain. " +
        "Generate one at https://developer.apple.com/account/resources/certificates and import it."
    );
  }
} catch (err) {
  fail(`security find-identity failed: ${err.message}`);
}

if (failed) {
  console.error("");
  console.error(
    "[check-notarize-env] One or more preflight checks failed. " +
      "Read docs/beta-release-checklist.md for the secure-credential-handling section " +
      "before fixing — the .p8 file should NEVER end up in this repo."
  );
  process.exit(1);
}

console.log("[check-notarize-env] All checks passed — safe to run electron-builder --mac.");
