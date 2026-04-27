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
 * Plays /System/Library/Sounds/Tink.aiff in a loop during the
 * capture window so AudioTee has signal. Uses GISTLIST_USER_DATA_DIR
 * pointed at a tempdir so the smoke does not touch the user's real
 * library.
 *
 * Exits 0 on pass, 1 on any failure with a clear message. Runs at
 * the end of `package:mac:sign`. Can be re-run standalone after
 * granting macOS permissions:
 *
 *   node packages/app/scripts/smoke-packaged-audio.mjs
 */
import { spawn } from "node:child_process";
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

// 6s engine capture window; allow generous wall-clock for spawn /
// CoreAudio init / TCC dialog rendering before forcing kill.
const SMOKE_TIMEOUT_MS = 30_000;

// dB floor that real ambient mic should clear comfortably; flat
// silence (the v0.1.1–v0.1.3 fingerprint) sits at -91 dB.
const MIN_MIC_MAX_DB = -75;

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
log(`temp data dir: ${tmpUserData}`);

let afplayChild = null;
let smokeChild = null;
let smokeKilled = false;

function cleanup() {
  if (afplayChild && !afplayChild.killed) {
    try {
      process.kill(afplayChild.pid, "SIGKILL");
    } catch {
      // already dead
    }
  }
  if (smokeChild && !smokeChild.killed) {
    try {
      smokeKilled = true;
      process.kill(smokeChild.pid, "SIGKILL");
    } catch {
      // already dead
    }
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
function startTinkLoop() {
  function spawnOne() {
    afplayChild = spawn("afplay", [TINK_AIFF], { stdio: "ignore" });
    afplayChild.on("exit", () => {
      if (smokeChild && !smokeKilled) {
        spawnOne();
      }
    });
  }
  spawnOne();
}

log(`launching ${exePath} --smoke-audio`);
startTinkLoop();

smokeChild = spawn(exePath, ["--smoke-audio"], {
  env: {
    ...process.env,
    GISTLIST_USER_DATA_DIR: tmpUserData,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdoutBuf = "";
let stderrBuf = "";
smokeChild.stdout.on("data", (d) => {
  stdoutBuf += d.toString("utf8");
});
smokeChild.stderr.on("data", (d) => {
  stderrBuf += d.toString("utf8");
});

const timer = setTimeout(() => {
  log(`timeout after ${SMOKE_TIMEOUT_MS}ms — killing smoke child`);
  smokeKilled = true;
  try {
    process.kill(smokeChild.pid, "SIGKILL");
  } catch {}
}, SMOKE_TIMEOUT_MS);

smokeChild.on("exit", (code) => {
  clearTimeout(timer);

  // Stop afplay before any further work — no need to keep playing.
  if (afplayChild && !afplayChild.killed) {
    try {
      process.kill(afplayChild.pid, "SIGKILL");
    } catch {}
  }

  if (smokeKilled) {
    fail(
      `smoke child timed out / was killed before printing JSON.\n` +
        `stdout so far:\n${stdoutBuf}\nstderr so far:\n${stderrBuf}\n` +
        `Most likely cause: macOS is blocking on a TCC permission prompt for ` +
        `Microphone or System Audio Recording. Click Allow on any prompt, ` +
        `then in System Settings → Privacy & Security verify Gistlist is ` +
        `enabled under both Microphone and System Audio Recording. ` +
        `Then re-run \`node packages/app/scripts/smoke-packaged-audio.mjs\`.`
    );
  }

  if (code !== 0) {
    fail(
      `smoke child exited with code ${code}.\n` +
        `stdout:\n${stdoutBuf}\nstderr:\n${stderrBuf}`
    );
  }

  // Pull the last non-empty JSON line — the main process may emit
  // unrelated logs before the smoke result.
  const lines = stdoutBuf.split("\n").map((l) => l.trim()).filter(Boolean);
  let parsed = null;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const candidate = JSON.parse(lines[i]);
      if (candidate && typeof candidate === "object") {
        parsed = candidate;
        break;
      }
    } catch {
      // not JSON; keep walking back
    }
  }
  if (!parsed) {
    fail(`smoke child did not print parseable JSON.\nstdout:\n${stdoutBuf}`);
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
