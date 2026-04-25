#!/usr/bin/env node
/**
 * Generate `main/build-flags.ts` from package.json's electron-builder
 * `publish` config.
 *
 * Inspects `build.publish.repo`:
 *   - Empty / missing  →  UPDATER_ENABLED = false  (default for dev / unsigned builds)
 *   - Real string       →  UPDATER_ENABLED = true   (production builds with a publish target)
 *
 * The shipped app reads these constants at runtime — there is no
 * `process.env` check at runtime in production. That keeps preload /
 * renderer state stable: `updater.getStatus()` returns
 * `{ enabled: false }` from inert handlers when disabled, instead of
 * deciding per-call based on env.
 *
 * The generated file is gitignored. Fresh clones run this script as a
 * prebuild step so `tsc -p tsconfig.main.json` always finds it.
 *
 * Run from anywhere — uses __dirname to anchor paths.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appPkgRoot = path.resolve(__dirname, "..");
const packageJsonPath = path.join(appPkgRoot, "package.json");
const outFile = path.join(appPkgRoot, "main", "build-flags.ts");

let pkg;
try {
  pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
} catch (err) {
  console.error(
    `[write-build-flags] cannot read ${packageJsonPath}: ${err.message}`
  );
  process.exit(1);
}

const publish = pkg?.build?.publish ?? null;

// publish may be a single object or an array of providers. We only care
// about the first entry for flag derivation; in practice we ship one.
const publishEntry = Array.isArray(publish) ? publish[0] : publish;

const provider = (publishEntry?.provider ?? "none").toString();
const repo = (publishEntry?.repo ?? "").toString().trim();

const enabled = repo.length > 0;

const banner = [
  "/**",
  " * GENERATED FILE — do not edit by hand.",
  " *",
  " * Written by scripts/write-build-flags.mjs as a prebuild step. The",
  " * values come from package.json's `build.publish` config. Bumping",
  " * the publish target is the only supported way to flip these flags.",
  " *",
  " * Gitignored on purpose — there's no human-meaningful diff to review.",
  " */",
].join("\n");

const body = [
  "",
  `export const UPDATER_ENABLED = ${enabled ? "true" : "false"} as const;`,
  `export const PUBLISH_PROVIDER = ${JSON.stringify(provider)} as const;`,
  `export const PUBLISH_REPO = ${JSON.stringify(repo)} as const;`,
  "",
].join("\n");

const contents = `${banner}\n${body}`;

// Avoid touching the file (and triggering tsc --watch rebuilds) when
// the contents haven't changed. Idempotent calls are common — every
// `npm run build` reaches this script.
let existing = "";
try {
  existing = fs.readFileSync(outFile, "utf-8");
} catch {
  // No existing file — proceed to write.
}

if (existing === contents) {
  console.log(
    `[write-build-flags] up to date (UPDATER_ENABLED=${enabled}, repo="${repo || "—"}")`
  );
  process.exit(0);
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, contents, "utf-8");

console.log(
  `[write-build-flags] wrote ${path.relative(appPkgRoot, outFile)} (UPDATER_ENABLED=${enabled}, repo="${repo || "—"}")`
);
