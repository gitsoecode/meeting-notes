/**
 * Regression test for issue #3: invoke `runVerifyExec` against the
 * actual Ollama binary we ship to users, with the production
 * verify-exec policy from the manifest. The bug Jamu hit lived in
 * `runVerifyExec`'s sanitized env (HOME stripped) — Ollama panics in
 * `envconfig.Models()` before argv parsing, so even `--version` exits
 * non-zero. The mock-backed Playwright suite couldn't see this; the
 * live-electron suite skips when Ollama isn't reachable, so a clean
 * install was never exercised. This test plugs that gap.
 *
 * Scope is deliberately narrow: download the real tarball pinned in
 * the manifest, hash it, extract the binary, and run verify-exec.
 * No Electron, no app state, no main process. The whole point is
 * to surface "the binary won't run under our verify-exec sandbox"
 * for any future tool/version bump that adds a new env requirement.
 *
 * Platform gating: the manifest's only Ollama entry is darwin, and
 * the binary is Mach-O — it cannot run on Linux. The test skips
 * cleanly off-darwin.
 *
 * Network gating: a sandbox without external network gets a skip
 * (not a fail). When the network is up but the upstream returns a
 * mismatched body, that's a real failure — surface it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { findManifestEntry } from "../dist/main/installers/manifest.js";
import { runVerifyExec } from "../dist/main/installers/verifyExec.js";

const CACHE_ROOT = path.join(os.tmpdir(), "gistlist-ollama-verify-exec-cache");

test("runVerifyExec succeeds against the real Ollama binary pinned in the manifest", async (t) => {
  if (process.platform !== "darwin") {
    t.skip("darwin-only: Ollama manifest entry and binary are Mach-O");
    return;
  }

  const entry = findManifestEntry(
    "ollama",
    process.arch === "arm64" ? "arm64" : "x64"
  );
  assert.ok(entry, "expected an Ollama manifest entry for this arch");
  assert.equal(entry.archiveType, "tgz", "test assumes tgz archive");

  // Cache key includes version so a manifest bump invalidates old artifacts.
  const cacheDir = path.join(CACHE_ROOT, `${entry.tool}-${entry.version}`);
  fs.mkdirSync(cacheDir, { recursive: true });
  const tarballPath = path.join(cacheDir, `${entry.tool}.tgz`);
  const extractDir = path.join(cacheDir, "extracted");

  // 1. Download (or reuse cached) and verify SHA-256.
  const cachedHashOk =
    fs.existsSync(tarballPath) &&
    (await sha256File(tarballPath)) === entry.sha256.toLowerCase();

  if (!cachedHashOk) {
    let downloaded = false;
    try {
      await downloadFollowingRedirects(entry.url, tarballPath, 5);
      downloaded = true;
    } catch (err) {
      // Sandboxed CI without external network: skip rather than fail.
      // A real network problem (DNS down, GitHub 5xx) should be visibly
      // skipped too — the gap to fix is environmental, not a code bug.
      t.skip(
        `network unavailable, cannot fetch ${entry.url}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return;
    }

    const actualSha = await sha256File(tarballPath);
    if (downloaded && actualSha !== entry.sha256.toLowerCase()) {
      // Drifted upstream tarball — this *is* a real failure: either
      // upstream re-published or our manifest pin is stale. Don't skip.
      try {
        fs.rmSync(tarballPath, { force: true });
      } catch {
        // best effort
      }
      assert.fail(
        `SHA-256 mismatch for ${entry.url}\n  expected ${entry.sha256}\n  got      ${actualSha}`
      );
    }
  }

  // 2. Extract.
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  await runProc("tar", ["-xzf", tarballPath, "-C", extractDir]);

  const binary = path.join(extractDir, entry.binaryPathInArchive);
  assert.ok(fs.existsSync(binary), `binary missing after extract: ${binary}`);
  fs.chmodSync(binary, 0o755);

  // 3. Real verify-exec under the production policy. Pre-fix, this
  // would print Ollama's `panic: $HOME is not defined` stack trace and
  // exit 2. Post-fix, HOME forwards through and the binary prints its
  // version banner.
  const result = await runVerifyExec(binary, entry.verifyExec);
  assert.equal(
    result.ok,
    true,
    `verify-exec failed; output:\n${result.output}\nerror: ${result.error}`
  );
  assert.equal(result.exitCode, entry.verifyExec.expectExit);
});

// ── helpers ──────────────────────────────────────────────────────────

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex").toLowerCase()));
  });
}

function downloadFollowingRedirects(url, destPath, redirectsLeft) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith("https:") ? https : http;
    const req = proto.get(url, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        if (redirectsLeft <= 0) {
          res.resume();
          return reject(new Error(`too many redirects from ${url}`));
        }
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        return downloadFollowingRedirects(next, destPath, redirectsLeft - 1)
          .then(resolve, reject);
      }
      if (status !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${status} for ${url}`));
      }
      const out = fs.createWriteStream(destPath);
      res.pipe(out);
      out.on("error", reject);
      out.on("close", () => resolve());
    });
    req.on("error", reject);
    req.setTimeout(30_000, () => {
      req.destroy(new Error("connection timeout"));
    });
  });
}

function runProc(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.trim()}`));
    });
  });
}
