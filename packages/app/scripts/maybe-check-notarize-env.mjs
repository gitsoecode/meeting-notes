#!/usr/bin/env node
/**
 * Tiny dispatcher: if `--sign` is anywhere in process.argv (after a
 * `--` separator that npm uses to pass flags through to the script
 * chain), run check-notarize-env.mjs. Otherwise no-op.
 *
 * Lets us wire the preflight into `npm run package:mac` without
 * forcing it on every local unsigned build:
 *
 *    npm run package:mac                  → unsigned, preflight skipped
 *    npm run package:mac -- --sign         → signed, preflight enforced
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// argv looks like: ["node", ".../maybe-check-notarize-env.mjs", "--sign"]
// The "--" separator npm injects is consumed by npm itself.
const wantsSigning = process.argv.slice(2).includes("--sign");

if (!wantsSigning) {
  console.log(
    "[maybe-check-notarize-env] no --sign flag — skipping notarize preflight"
  );
  process.exit(0);
}

const result = spawnSync(
  process.execPath,
  [path.join(__dirname, "check-notarize-env.mjs")],
  { stdio: "inherit" }
);

process.exit(result.status ?? 1);
