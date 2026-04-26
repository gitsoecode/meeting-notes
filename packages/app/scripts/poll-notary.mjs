#!/usr/bin/env node
/**
 * Poll Apple's notary service for a submission's status.
 *
 * Usage:
 *   node scripts/poll-notary.mjs               # uses most-recent submission
 *   node scripts/poll-notary.mjs <id>          # specific submission id
 *   APPLE_KEYCHAIN_PROFILE=foo node scripts/poll-notary.mjs
 *
 * Exits 0 once status is "Accepted", non-zero otherwise.
 * Does NOT staple — that's notarize-release.mjs's job. This is read-only.
 */
import { execFileSync } from "node:child_process";

const keychainProfile =
  process.env.APPLE_KEYCHAIN_PROFILE ?? "gistlist-notary";
const intervalMs = Number(process.env.POLL_INTERVAL_MS ?? 30_000);

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[poll-notary ${ts}] ${msg}`);
}

function read(args) {
  return execFileSync("xcrun", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

let submissionId = process.argv[2];

if (!submissionId) {
  log("no submission id passed — looking up most recent from history");
  const historyJson = read([
    "notarytool",
    "history",
    "--keychain-profile",
    keychainProfile,
    "--output-format",
    "json",
  ]);
  const history = JSON.parse(historyJson);
  const latest = history.history?.[0];
  if (!latest?.id) {
    console.error("no submissions found in notary history");
    process.exit(2);
  }
  submissionId = latest.id;
  log(`latest submission: ${submissionId} (created ${latest.createdDate})`);
}

let status = "In Progress";
while (status === "In Progress") {
  try {
    const infoJson = read([
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
    log(`status: ${status}`);
  } catch (err) {
    log(`status check failed; retrying: ${err.stderr?.toString() || err.message}`);
  }
  if (status === "In Progress") sleep(intervalMs);
}

if (status !== "Accepted") {
  log(`fetching log for failed submission ${submissionId}`);
  try {
    execFileSync(
      "xcrun",
      ["notarytool", "log", submissionId, "--keychain-profile", keychainProfile],
      { stdio: "inherit" }
    );
  } catch (err) {
    log(`failed to fetch log: ${err.message}`);
  }
  process.exit(1);
}

log(`submission ${submissionId} accepted`);
log("next: cd packages/app && npx electron-builder --mac --publish never  # OR re-run notarize-release.mjs to staple");
