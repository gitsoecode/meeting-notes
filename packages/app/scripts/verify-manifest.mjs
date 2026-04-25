#!/usr/bin/env node
/**
 * Manifest hash verifier.
 *
 * For each entry in TOOL_MANIFEST:
 *   1. HTTP GET the URL (following redirects up to 5 hops).
 *   2. Stream-hash the bytes with SHA-256 (no buffering full payload).
 *   3. Assert the committed `sha256` matches.
 *
 * Exits 0 on success or empty manifest. Exits 1 on any mismatch /
 * network failure, with the failing entry printed.
 *
 * Reads from `dist/main/installers/manifest.js` — must be run after
 * `npm run build:main`. The CI wiring in `npm test` already runs the
 * build step before this script.
 */
import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const manifestPath = path.resolve(
  __dirname,
  "..",
  "dist",
  "main",
  "installers",
  "manifest.js"
);

let TOOL_MANIFEST;
try {
  ({ TOOL_MANIFEST } = await import(manifestPath));
} catch (err) {
  console.error(
    `[verify-manifest] failed to import compiled manifest at ${manifestPath}`
  );
  console.error(`[verify-manifest] run \`npm run build:main\` first.`);
  console.error(`[verify-manifest] underlying error: ${err.message}`);
  process.exit(1);
}

/**
 * Stream a URL through SHA-256 and report the digest + byte count.
 * Follows up to 5 redirects. Times out after 60s of no data.
 */
function fetchAndHash(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith("https:") ? https : http;
    const req = proto.get(url, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        if (redirectsLeft <= 0) {
          res.resume();
          return reject(new Error(`Too many redirects starting at ${url}`));
        }
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        return fetchAndHash(next, redirectsLeft - 1).then(resolve, reject);
      }
      if (status !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${status} for ${url}`));
      }
      const hasher = crypto.createHash("sha256");
      let bytes = 0;
      res.on("data", (chunk) => {
        hasher.update(chunk);
        bytes += chunk.length;
      });
      res.on("end", () => {
        resolve({ hash: hasher.digest("hex"), bytes });
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(60_000, () => {
      req.destroy(new Error(`Timeout (60s) fetching ${url}`));
    });
  });
}

async function main() {
  if (process.env.SKIP_MANIFEST_VERIFY === "1") {
    console.log(
      "[verify-manifest] SKIP_MANIFEST_VERIFY=1 — bypassing network checks."
    );
    return;
  }

  if (!Array.isArray(TOOL_MANIFEST) || TOOL_MANIFEST.length === 0) {
    console.log(
      "[verify-manifest] manifest is empty — no entries to verify (expected during Phase 0/1)."
    );
    return;
  }

  let failures = 0;

  for (const entry of TOOL_MANIFEST) {
    const label = `${entry.tool}@${entry.version} (${entry.arch})`;
    process.stdout.write(`[verify-manifest] ${label} ... `);
    try {
      const { hash, bytes } = await fetchAndHash(entry.url);
      if (hash !== entry.sha256) {
        console.log("MISMATCH");
        console.log(`  url:      ${entry.url}`);
        console.log(`  bytes:    ${bytes}`);
        console.log(`  expected: ${entry.sha256}`);
        console.log(`  actual:   ${hash}`);
        failures++;
      } else {
        console.log(`OK (${bytes} bytes)`);
      }
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      failures++;
    }
  }

  if (failures > 0) {
    console.error(
      `[verify-manifest] ${failures} of ${TOOL_MANIFEST.length} entries failed`
    );
    process.exit(1);
  }
  console.log(
    `[verify-manifest] all ${TOOL_MANIFEST.length} entries verified`
  );
}

main().catch((err) => {
  console.error(`[verify-manifest] fatal: ${err.stack ?? err.message ?? err}`);
  process.exit(1);
});
