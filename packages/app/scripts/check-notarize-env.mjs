#!/usr/bin/env node
/**
 * Notarization preflight.
 *
 * Run by `npm run package:mac:sign` before electron-builder starts.
 * Exits non-zero with a clear message if the signing/notarization
 * setup is incomplete, so the user doesn't burn minutes on a
 * round-trip that's going to fail.
 *
 * Authentication path: keychain profile (Apple's recommended
 * approach for notarytool, set up via
 * `xcrun notarytool store-credentials`). The package.json
 * `build.mac.notarize` block names the profile + team ID; this
 * script reads it back and validates each piece is reachable:
 *
 *   1. `build.mac.notarize.keychainProfile` is set.
 *   2. `build.mac.notarize.teamId` is set and shape-correct.
 *   3. `xcrun notarytool history --keychain-profile <name>` runs
 *      without prompting for credentials (proves Apple accepts the
 *      stored .p8 + key ID + issuer).
 *   4. `security find-identity -v -p codesigning` lists at least
 *      one "Developer ID Application" certificate.
 *
 * Note: env-var auth (APPLE_API_KEY / APPLE_API_KEY_ID /
 * APPLE_API_ISSUER) is supported as a fallback when the keychain
 * profile isn't configured. Set `notarize: false` in package.json
 * to skip notarization entirely (unsigned local builds).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_PKG_ROOT = path.resolve(__dirname, "..");

let failed = false;

function fail(message) {
  console.error(`[check-notarize-env] ✘ ${message}`);
  failed = true;
}

function pass(message) {
  console.log(`[check-notarize-env] ✓ ${message}`);
}

// Read the notarize config from package.json so this script and
// electron-builder agree on which auth path is in use.
const pkg = JSON.parse(
  fs.readFileSync(path.join(APP_PKG_ROOT, "package.json"), "utf-8")
);
const notarize = pkg?.build?.mac?.notarize ?? null;

// Keychain-profile path: electron-builder v25's notarize schema only
// accepts `teamId` — the profile name comes via APPLE_KEYCHAIN_PROFILE
// env var (set by scripts/package-with-engine-staged.mjs in the spawn
// env). The preflight defaults to the same profile name the wrapper
// uses ("gistlist-notary"), which is what the docs walk users through
// in release/beta-release-checklist.md.
if (notarize && typeof notarize === "object" && notarize.teamId) {
  const keychainProfile =
    process.env.APPLE_KEYCHAIN_PROFILE ?? "gistlist-notary";
  const { teamId } = notarize;

  if (typeof keychainProfile !== "string" || keychainProfile.length === 0) {
    fail("build.mac.notarize.keychainProfile is empty in package.json.");
  } else {
    pass(`Keychain profile name configured: "${keychainProfile}"`);
  }

  if (typeof teamId !== "string" || !/^[A-Z0-9]{10}$/.test(teamId)) {
    fail(
      `build.mac.notarize.teamId looks malformed: "${teamId}" (expected 10 uppercase alphanumeric chars, e.g. UZ8554JSAM).`
    );
  } else {
    pass(`Team ID has the expected shape (${teamId})`);
  }

  // Live check: does Apple actually accept the stored credentials?
  // `notarytool history` is read-only, returns instantly even with
  // no submissions, and will throw with a clear "401 Unauthorized"
  // or similar if the .p8 / key-id / issuer in the stored profile
  // aren't valid against Apple Connect.
  try {
    execFileSync(
      "xcrun",
      ["notarytool", "history", "--keychain-profile", keychainProfile],
      { stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" }
    );
    pass(
      `Keychain profile "${keychainProfile}" authenticates against Apple's notary service`
    );
  } catch (err) {
    fail(
      `Keychain profile "${keychainProfile}" failed to authenticate. ` +
        `Re-run \`xcrun notarytool store-credentials ${keychainProfile} ` +
        `--key <p8> --key-id <id> --issuer <uuid>\`. ` +
        `Underlying error: ${err.stderr?.toString() || err.message}`
    );
  }
} else if (process.env.APPLE_API_KEY || process.env.APPLE_API_KEY_ID) {
  // ---- Env-var fallback path ----
  pass(
    "Falling back to env-var auth (APPLE_API_KEY / APPLE_API_KEY_ID / APPLE_API_ISSUER)"
  );

  const apiKeyPath = process.env.APPLE_API_KEY;
  if (!apiKeyPath) {
    fail("APPLE_API_KEY is not set.");
  } else if (!fs.existsSync(apiKeyPath)) {
    fail(`APPLE_API_KEY points to ${apiKeyPath}, which does not exist.`);
  } else {
    try {
      fs.accessSync(apiKeyPath, fs.constants.R_OK);
      pass(`APPLE_API_KEY exists and is readable (${apiKeyPath})`);
    } catch {
      fail(
        `APPLE_API_KEY at ${apiKeyPath} is not readable — chmod 600 it.`
      );
    }
  }

  const apiKeyId = process.env.APPLE_API_KEY_ID;
  if (!apiKeyId) {
    fail("APPLE_API_KEY_ID is not set.");
  } else if (!/^[A-Z0-9]{10}$/.test(apiKeyId)) {
    fail(`APPLE_API_KEY_ID looks malformed: "${apiKeyId}".`);
  } else {
    pass(`APPLE_API_KEY_ID has the expected shape (${apiKeyId})`);
  }

  const issuer = process.env.APPLE_API_ISSUER;
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!issuer) {
    fail("APPLE_API_ISSUER is not set.");
  } else if (!uuidRe.test(issuer)) {
    fail(`APPLE_API_ISSUER looks malformed: "${issuer}".`);
  } else {
    pass("APPLE_API_ISSUER has the expected UUID shape");
  }
} else {
  fail(
    "No notarization auth configured. Set up a keychain profile with " +
      "`xcrun notarytool store-credentials gistlist-notary --key ... --key-id ... --issuer ...` " +
      "and add `build.mac.notarize: { teamId, keychainProfile }` to package.json."
  );
}

// Common: Developer ID Application cert in keychain. Required regardless
// of which notarization auth path is in use — the cert signs the bundle
// before notarization even sees it.
try {
  const out = execFileSync(
    "security",
    ["find-identity", "-v", "-p", "codesigning"],
    { encoding: "utf-8" }
  );
  if (/Developer ID Application/i.test(out)) {
    const match = out.match(/Developer ID Application:.+?\(.+?\)/);
    pass(`Developer ID Application cert found${match ? ` (${match[0]})` : ""}`);
  } else {
    fail(
      "No 'Developer ID Application' certificate in your login keychain. " +
        "Generate one at https://developer.apple.com/account/resources/certificates, " +
        "double-click the .cer to import, and run again."
    );
  }
} catch (err) {
  fail(`security find-identity failed: ${err.message}`);
}

if (failed) {
  console.error("");
  console.error(
    "[check-notarize-env] One or more preflight checks failed. " +
      "Read docs/private_plans/release/beta-release-checklist.md §1 for the " +
      "secure-credential-handling walkthrough."
  );
  process.exit(1);
}

console.log(
  "[check-notarize-env] All checks passed — safe to run electron-builder --mac."
);
