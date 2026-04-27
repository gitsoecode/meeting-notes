#!/usr/bin/env node
/**
 * Packaged audio smoke driver.
 *
 * Runs the freshly built, signed, notarized .app under
 * release/mac-arm64/ via a hidden `--smoke-audio` flag (handled in
 * packages/app/main/index.ts) and asserts the binary actually
 * captures non-silent mic + system audio. This is the integration
 * test for the v0.1.1–v0.1.3 mic-entitlement bug — static checks
 * (entitlement keys present, signature valid, manifest matches)
 * prove the build *should* work; this proves it *does*.
 *
 * Why we launch via `open -n -W` instead of spawning the binary
 * directly: macOS TCC walks up the process tree to find the
 * "responsible" app for permission attribution. If we spawn the
 * Gistlist binary as a child of node (driver) — which is itself a
 * child of whatever shell or agent harness invoked the driver —
 * macOS attributes TCC checks to that ancestor and Gistlist's own
 * Microphone / System Audio Recording grants do not apply. The
 * symptom is captured-but-flat-silence audio, identical to the
 * v0.1.1–v0.1.3 fingerprint we are trying to detect. `open` routes
 * through LaunchServices/launchd and establishes the launched bundle
 * as its own responsible TCC session, so user grants apply normally.
 *
 * Plays /System/Library/Sounds/Tink.aiff in a loop during the
 * capture window so AudioTee has signal. Uses GISTLIST_USER_DATA_DIR
 * pointed at a tempdir (passed via `open --env`) so the smoke does
 * not touch the user's real library.
 *
 * Exits 0 on pass, 1 on any failure with a clear message. Runs at
 * the end of `package:mac:sign`. Can be re-run standalone after
 * granting macOS permissions:
 *
 *   node packages/app/scripts/smoke-packaged-audio.mjs
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_PKG_ROOT = path.resolve(__dirname, "..");

const arch = process.env.GISTLIST_RELEASE_ARCH ?? "arm64";
const releaseDir =
  process.env.GISTLIST_RELEASE_DIR ?? path.join(APP_PKG_ROOT, "release");

const pkg = JSON.parse(
  fs.readFileSync(path.join(APP_PKG_ROOT, "package.json"), "utf8")
);
const productName = pkg.build?.productName ?? "Gistlist";

const appDir = path.join(releaseDir, `mac-${arch}`, `${productName}.app`);
const exePath = path.join(appDir, "Contents", "MacOS", productName);
const TINK_AIFF = "/System/Library/Sounds/Tink.aiff";

// Wall-clock cap on `open -W`. The entrypoint itself watchdogs at
// 25s, so the driver only needs a small amount of headroom for the
// `open` -> launchd -> Electron-init handshake.
const OPEN_TIMEOUT_MS = 60_000;

// dB floor for the mic-captured-anything check. The v0.1.1–v0.1.3
// fingerprint is max=-91 (flat digital zeros — every buffer literally
// all-zero because macOS denied the entitlement check). Real captured
// audio in a quiet room sits ~ -75 to -80 max with -91 mean; busy
// rooms or speech clear -65. -85 is generous enough not to false-fail
// in quiet rooms, tight enough that any flat-zero ship would fail
// loudly. Don't tighten below -80 without evidence — quiet ambient
// sometimes legitimately drops to -78 max even when the mic is
// healthy.
const MIN_MIC_MAX_DB = -85;

function log(msg) {
  console.log(`[smoke-packaged-audio] ${msg}`);
}

function fail(msg) {
  console.error(`[smoke-packaged-audio] FAIL — ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(exePath)) {
  fail(
    `expected packaged binary not found at ${exePath} — run \`npm run package:mac:sign\` first`
  );
}
if (!fs.existsSync(TINK_AIFF)) {
  fail(`system sound for system-audio signal not found: ${TINK_AIFF}`);
}

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), "gistlist-smoke-"));
const reportPath = path.join(tmpUserData, "smoke-result.json");
const stdoutLogPath = path.join(tmpUserData, "smoke-stdout.log");
const stderrLogPath = path.join(tmpUserData, "smoke-stderr.log");
log(`temp data dir: ${tmpUserData}`);

let afplayChild = null;
let openChild = null;

function cleanup() {
  if (afplayChild && !afplayChild.killed) {
    try {
      process.kill(afplayChild.pid, "SIGKILL");
    } catch {
      // already dead
    }
  }
  if (openChild && !openChild.killed) {
    try {
      process.kill(openChild.pid, "SIGKILL");
    } catch {
      // already dead
    }
  }
  // Best-effort kill of any straggling Gistlist instance launched by
  // open. The launchd-parented PID is not visible to us, but pkill
  // by exact path will reach it.
  try {
    spawnSync("pkill", ["-f", exePath], { stdio: "ignore" });
  } catch {
    // pkill not present — non-fatal.
  }
  try {
    fs.rmSync(tmpUserData, { recursive: true, force: true });
  } catch {
    // OS cleans tmpdir eventually
  }
}

process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

// Loop afplay on Tink.aiff so AudioTee always has signal during the
// capture window. The clip is short (~0.3s); restart it whenever it
// exits. Stops as soon as we kill it during cleanup.
let afplayLooping = true;
function startTinkLoop() {
  function spawnOne() {
    if (!afplayLooping) return;
    afplayChild = spawn("afplay", [TINK_AIFF], { stdio: "ignore" });
    afplayChild.on("exit", () => {
      if (afplayLooping) spawnOne();
    });
  }
  spawnOne();
}

log(`launching ${appDir} via \`open -n -W -a\` with --smoke-audio`);
startTinkLoop();

openChild = spawn(
  "open",
  [
    "-n", // new instance
    "-W", // wait for app to exit
    "-g", // do not bring to foreground / steal focus
    "-a",
    appDir,
    "--env",
    `GISTLIST_USER_DATA_DIR=${tmpUserData}`,
    // Two-factor gate paired with the --smoke-audio CLI flag. The
    // entrypoint refuses to enter smoke mode without this env var, so
    // a Dock/Finder launch (which can pass --args but cannot inject
    // env) never reaches the mic/system tap path even if the flag
    // leaks.
    "--env",
    "GISTLIST_ALLOW_SMOKE_AUDIO=1",
    "--stdout",
    stdoutLogPath,
    "--stderr",
    stderrLogPath,
    "--args",
    "--smoke-audio",
    `--smoke-output=${reportPath}`,
  ],
  { stdio: ["ignore", "pipe", "pipe"] }
);

let openStdout = "";
let openStderr = "";
openChild.stdout.on("data", (d) => {
  openStdout += d.toString("utf8");
});
openChild.stderr.on("data", (d) => {
  openStderr += d.toString("utf8");
});

const timer = setTimeout(() => {
  log(`open -W timed out after ${OPEN_TIMEOUT_MS}ms`);
  try {
    process.kill(openChild.pid, "SIGKILL");
  } catch {}
}, OPEN_TIMEOUT_MS);

openChild.on("exit", (openCode) => {
  clearTimeout(timer);

  // Stop afplay before any further work — no need to keep playing.
  afplayLooping = false;
  if (afplayChild && !afplayChild.killed) {
    try {
      process.kill(afplayChild.pid, "SIGKILL");
    } catch {}
  }

  if (openCode !== 0 && openCode !== null) {
    fail(
      `open exited with code ${openCode}.\n` +
        `open stdout: ${openStdout}\nopen stderr: ${openStderr}`
    );
  }

  if (!fs.existsSync(reportPath)) {
    const stdoutDump = fs.existsSync(stdoutLogPath)
      ? fs.readFileSync(stdoutLogPath, "utf8")
      : "(no stdout file)";
    const stderrDump = fs.existsSync(stderrLogPath)
      ? fs.readFileSync(stderrLogPath, "utf8")
      : "(no stderr file)";
    fail(
      `smoke entrypoint did not write a result file at ${reportPath}.\n` +
        `Most likely cause: macOS is blocking on a TCC permission prompt for ` +
        `Microphone or System Audio Recording, and the entrypoint's 25s ` +
        `watchdog tripped before it could capture audio.\n\n` +
        `Click Allow on any prompt, then in System Settings → Privacy & ` +
        `Security verify Gistlist is enabled under both Microphone and ` +
        `System Audio Recording. Then re-run this script.\n\n` +
        `app stdout (from --stdout):\n${stdoutDump}\n` +
        `app stderr (from --stderr):\n${stderrDump}`
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  } catch (err) {
    fail(
      `failed to parse smoke result at ${reportPath}: ` +
        (err instanceof Error ? err.message : String(err))
    );
  }

  if (parsed.error) {
    fail(
      `smoke threw inside the packaged app: ${parsed.error}\n` +
        (parsed.stack ? `stack:\n${parsed.stack}` : "")
    );
  }

  const results = Array.isArray(parsed.results) ? parsed.results : [];
  const mic = results.find((r) => r.role === "mic");
  const system = results.find((r) => r.role === "system");

  if (!mic) fail(`report has no mic result. raw: ${JSON.stringify(parsed)}`);
  if (!system) fail(`report has no system result. raw: ${JSON.stringify(parsed)}`);

  const failures = [];
  if (!mic.recorded) failures.push(`mic.recorded=false (error: ${mic.error ?? "(none)"})`);
  if ((mic.fileSizeBytes ?? 0) <= 100) failures.push(`mic.fileSizeBytes=${mic.fileSizeBytes} (expected >100)`);
  if ((mic.maxVolumeDb ?? -91) <= MIN_MIC_MAX_DB) {
    failures.push(
      `mic.maxVolumeDb=${mic.maxVolumeDb} dB (expected > ${MIN_MIC_MAX_DB}). ` +
        `This is the v0.1.1–v0.1.3 fingerprint — silent buffers despite a granted permission.`
    );
  }
  if (!system.recorded) failures.push(`system.recorded=false (error: ${system.error ?? "(none)"})`);
  if ((system.fileSizeBytes ?? 0) <= 100) failures.push(`system.fileSizeBytes=${system.fileSizeBytes} (expected >100)`);
  if (system.isSilent !== false) {
    failures.push(
      `system.isSilent=${system.isSilent} (expected false; afplay was looping Tink.aiff during the test). ` +
        `If this is the only failure, check System Settings → Privacy & Security → System Audio Recording and ensure Gistlist is allowed.`
    );
  }

  if (failures.length > 0) {
    fail(
      `smoke assertions failed:\n  - ` +
        failures.join("\n  - ") +
        `\nfull report:\n${JSON.stringify(parsed, null, 2)}`
    );
  }

  // TCC log probe — this is the canonical fingerprint for the
  // missing-mic-entitlement bug.
  log("running TCC log probe");
  const probe = spawn(
    "log",
    [
      "show",
      "--predicate",
      'subsystem == "com.apple.TCC" && (eventMessage CONTAINS "Gistlist" OR eventMessage CONTAINS "ffmpeg")',
      "--last",
      "5m",
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  let probeOut = "";
  probe.stdout.on("data", (d) => {
    probeOut += d.toString("utf8");
  });
  probe.on("exit", () => {
    if (
      /requires entitlement com\.apple\.security\.device\.audio-input but it is missing/.test(
        probeOut
      )
    ) {
      fail(
        `TCC log shows the v0.1.1–v0.1.3 fingerprint:\n` +
          `  "requires entitlement com.apple.security.device.audio-input but it is missing"\n` +
          `The packaged build is shipping without the mic entitlement. STOP — do not tag.`
      );
    }
    log(
      `PASS — mic.maxVolumeDb=${mic.maxVolumeDb}, system.isSilent=${system.isSilent}, no TCC entitlement-missing line in last 5m`
    );
    process.exit(0);
  });
});
