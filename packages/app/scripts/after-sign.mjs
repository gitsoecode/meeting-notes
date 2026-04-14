// electron-builder afterSign hook.
//
// By default, electron-builder signs all binaries it finds inside the app
// bundle using the main app's entitlements. The bundled `audiotee` helper in
// Contents/MacOS/audiotee needs a *different* entitlement
// (`com.apple.security.inherit`) so that macOS TCC attributes its permission
// requests to the parent Meeting Notes.app rather than to audiotee itself.
//
// Without this, the "System Audio Recording" grant the user gives to Meeting
// Notes is never consulted when audiotee calls the CoreAudio taps API, and
// the helper silently streams buffers of zeros (a known AudioTee failure
// mode — see node_modules/audiotee/README.md#permissions).
//
// This hook runs after electron-builder's default signing and re-signs only
// the audiotee helper with the correct entitlement, preserving whatever
// identity (ad-hoc, Developer ID, etc.) was used for the rest of the bundle.
import { execSync } from "node:child_process";
import fs from "node:fs";
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

export default async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;

  const { appOutDir, packager } = context;
  const productName = packager.appInfo.productFilename;
  const audioteePath = path.join(
    appOutDir,
    `${productName}.app`,
    "Contents",
    "MacOS",
    "audiotee"
  );

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

  // Pull the signing identity electron-builder used for the main bundle so we
  // re-sign audiotee with the same identity. Falls back to ad-hoc ("-") when
  // no Developer ID is configured, which is fine for local builds.
  const identity =
    packager.platformSpecificBuildOptions?.identity ??
    process.env.CSC_IDENTITY_AUTO_DISCOVERY === "false"
      ? "-"
      : packager.codeSigningInfo?.value?.identityName ?? "-";

  const args = [
    "--force",
    "--timestamp",
    "--options",
    "runtime", // match hardenedRuntime on the main app
    "--sign",
    JSON.stringify(identity === "-" ? "-" : identity),
    "--entitlements",
    JSON.stringify(ENTITLEMENTS),
    JSON.stringify(audioteePath),
  ];

  console.log(
    `[after-sign] re-signing audiotee with com.apple.security.inherit entitlement (identity: ${identity})`
  );
  try {
    execSync(`codesign ${args.join(" ")}`, { stdio: "inherit" });
  } catch (err) {
    throw new Error(
      `[after-sign] codesign failed for audiotee: ${err.message}`
    );
  }

  // Verify the signature stuck.
  try {
    execSync(
      `codesign --verify --verbose=2 ${JSON.stringify(audioteePath)}`,
      { stdio: "inherit" }
    );
  } catch (err) {
    throw new Error(
      `[after-sign] signature verification failed: ${err.message}`
    );
  }
  console.log("[after-sign] audiotee re-signed successfully");
}
