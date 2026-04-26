// electron-builder afterSign hook.
//
// By default, electron-builder signs all binaries it finds inside the app
// bundle using the main app's entitlements. The bundled `audiotee` helper in
// Contents/MacOS/audiotee needs a *different* entitlement
// (`com.apple.security.inherit`) so that macOS TCC attributes its permission
// requests to the parent Gistlist.app rather than to audiotee itself.
//
// Without this, the "System Audio Recording" grant the user gives to Gistlist
// is never consulted when audiotee calls the CoreAudio taps API, and the
// helper silently streams buffers of zeros (a known AudioTee failure mode —
// see node_modules/audiotee/README.md#permissions).
//
// This hook runs after electron-builder's default signing and:
//   1. re-signs audiotee with `com.apple.security.inherit`, using the same
//      Developer ID identity electron-builder used (or ad-hoc for local dev),
//   2. re-signs the parent .app bundle so its CodeResources hash for audiotee
//      stays valid — without --deep, so audiotee's fresh entitlement survives.
//
// Step 2 is required because the bundle's _CodeSignature/CodeResources file
// contains content+signature hashes for every nested binary. Changing
// audiotee's signature invalidates that hash; without re-sealing the bundle,
// notarization rejects the main Gistlist binary as "signature invalid".
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appPkgRoot = path.resolve(__dirname, "..");

const ENTITLEMENTS = path.join(
  appPkgRoot,
  "resources",
  "audiotee-inherit.entitlements"
);

function findDeveloperIdIdentity() {
  // Independent of electron-builder's API surface (which has shifted across
  // major versions). `security find-identity -v -p codesigning` lists every
  // valid signing identity in the user keychain; we pick the first
  // "Developer ID Application" entry.
  try {
    const out = execSync("security find-identity -v -p codesigning", {
      encoding: "utf8",
    });
    const match = out.match(
      /^\s*\d+\)\s+[A-F0-9]{40}\s+"(Developer ID Application:[^"]+)"/m
    );
    if (match) return match[1];
  } catch {
    // fall through to ad-hoc
  }
  return null;
}

function resolveSigningIdentity(packager) {
  const configuredIdentity = packager.platformSpecificBuildOptions?.identity;
  if (configuredIdentity && configuredIdentity !== "-") {
    return configuredIdentity;
  }
  if (process.env.CSC_IDENTITY_AUTO_DISCOVERY === "false") return "-";
  const developerId = findDeveloperIdIdentity();
  return developerId ?? "-";
}

export default async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;

  const { appOutDir, packager } = context;
  const productName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${productName}.app`);
  const audioteePath = path.join(appPath, "Contents", "MacOS", "audiotee");

  if (!fs.existsSync(audioteePath)) {
    console.warn(
      `[after-sign] audiotee not found at ${audioteePath} — skipping re-sign`
    );
    return;
  }
  if (!fs.existsSync(ENTITLEMENTS)) {
    throw new Error(
      `[after-sign] entitlements file missing at ${ENTITLEMENTS}`
    );
  }

  const identity = resolveSigningIdentity(packager);
  const isAdHoc = identity === "-";

  // Step 1: re-sign audiotee with inherit entitlement.
  const audioteeArgs = [
    "--force",
    "--options",
    "runtime",
    "--sign",
    identity,
    "--entitlements",
    ENTITLEMENTS,
  ];
  if (!isAdHoc) audioteeArgs.push("--timestamp");
  audioteeArgs.push(audioteePath);

  console.log(
    `[after-sign] re-signing audiotee with com.apple.security.inherit (identity: ${identity})`
  );
  execFileSync("codesign", audioteeArgs, { stdio: "inherit" });

  execFileSync("codesign", ["--verify", "--verbose=2", audioteePath], {
    stdio: "inherit",
  });
  const audioteeEntitlements = execSync(
    `codesign -dv --entitlements - ${JSON.stringify(audioteePath)} 2>&1`,
    { encoding: "utf8" }
  );
  if (!audioteeEntitlements.includes("com.apple.security.inherit")) {
    throw new Error(
      "[after-sign] audiotee missing com.apple.security.inherit entitlement after re-sign"
    );
  }
  console.log("[after-sign] audiotee re-signed successfully");

  // Step 2: re-seal the .app bundle. Necessary because the CodeResources
  // hash for audiotee just changed. Skip for ad-hoc (local dev) — the bundle
  // is already ad-hoc and Gatekeeper won't be involved.
  if (isAdHoc) {
    console.log("[after-sign] ad-hoc identity — skipping bundle re-seal");
    return;
  }

  // Extract the existing entitlements from the main Gistlist binary so the
  // re-seal preserves them exactly. Writing to a tmp file because codesign's
  // --entitlements flag wants a path.
  const mainExec = path.join(appPath, "Contents", "MacOS", productName);
  const mainEntitlementsPath = path.join(
    os.tmpdir(),
    `gistlist-main-entitlements-${process.pid}.plist`
  );
  try {
    const xml = execSync(
      `codesign -d --entitlements :- ${JSON.stringify(mainExec)}`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    fs.writeFileSync(mainEntitlementsPath, xml);
  } catch (err) {
    throw new Error(
      `[after-sign] failed to extract main bundle entitlements: ${err.message}`
    );
  }

  const bundleArgs = [
    "--force",
    "--options",
    "runtime",
    "--sign",
    identity,
    "--entitlements",
    mainEntitlementsPath,
    "--timestamp",
    appPath,
  ];
  console.log(`[after-sign] re-sealing ${appPath} to refresh CodeResources`);
  try {
    execFileSync("codesign", bundleArgs, { stdio: "inherit" });
    execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], {
      stdio: "inherit",
    });
  } finally {
    try {
      fs.unlinkSync(mainEntitlementsPath);
    } catch {
      // ignore
    }
  }
  console.log("[after-sign] bundle re-sealed successfully");
}
