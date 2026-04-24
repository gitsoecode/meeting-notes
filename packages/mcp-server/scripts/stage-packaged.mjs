#!/usr/bin/env node
/**
 * Produces `dist/packaged/` for electron-builder's extraResources:
 *   dist/packaged/server.js                          esbuild single-file bundle
 *   dist/packaged/node_modules/better-sqlite3/...    native addon (+ js shims)
 *   dist/packaged/node_modules/bindings/...          better-sqlite3 runtime dep
 *   dist/packaged/node_modules/file-uri-to-path/...  bindings runtime dep
 *   dist/packaged/node_modules/sqlite-vec/...        js shim
 *   dist/packaged/node_modules/sqlite-vec-darwin-arm64/...  platform .dylib
 *   dist/packaged/node_modules/sqlite-vec-darwin-x64/...    (best-effort)
 *
 * Runtime lookup: the bundled server.js does `require("better-sqlite3")`
 * which Node resolves by walking up from server.js's directory — so the
 * co-located `node_modules/` is found automatically. No NODE_PATH needed.
 *
 * Signing: we do NOT ad-hoc sign here. electron-builder signs every binary
 * inside the packaged app bundle with the app's Developer ID, which is what
 * macOS library validation requires when the MCP server runs as a child of
 * the Gistlist app (same Team ID as the host).
 *
 * ABI: we expect better-sqlite3 to already be built for Electron's ABI via
 * the app's `rebuild:native` script. We don't rebuild or swap prebuilds here.
 */
import { build } from "esbuild";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(PKG_ROOT, "../..");
const OUT = path.join(PKG_ROOT, "dist/packaged");
const OUT_NM = path.join(OUT, "node_modules");

// Kept alongside the bundle so Node's module resolution finds them at runtime.
// Pure-JS deps are inlined by esbuild; only native modules (and their runtime
// JS glue) need to ship as files.
const NATIVE_MODULES = [
  "better-sqlite3",
  "bindings",
  "file-uri-to-path",
];
const SQLITE_VEC_PACKAGES = [
  "sqlite-vec",
  "sqlite-vec-darwin-arm64",
  // x64 is optional — CI matrix can populate it; a dev machine usually only has one arch.
  "sqlite-vec-darwin-x64",
];

function hasAddonUnder(dir) {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".node")) return true;
      if (entry.isDirectory()) {
        if (hasAddonUnder(path.join(dir, entry.name))) return true;
      }
    }
  } catch {
    // ignore
  }
  return false;
}

const COPY_FILTERS = {
  "better-sqlite3": (rel, src) => {
    if (rel === "") return true;
    const parts = rel.split(path.sep);
    const top = parts[0];
    if (top === "node_modules") return false;
    if (top === "deps") return false; // sqlite C source amalgamation
    if (top === "src") return false; // C++ binding source
    if (rel === "binding.gyp") return false;
    if (top === "prebuilds") return false; // single-ABI: only build/Release matters
    if (top === "build") {
      if (rel === "build") return true;
      if (rel === path.join("build", "Release")) return true;
      const relParts = rel.split(path.sep);
      if (relParts[1] !== "Release") return false;
      if (rel.endsWith(".node")) return true;
      try {
        const abs = path.join(src, rel);
        if (statSync(abs).isDirectory()) return hasAddonUnder(abs);
      } catch {
        // best-effort
      }
      return false;
    }
    return true;
  },
};

function copyModule(name, required) {
  const src = path.join(REPO_ROOT, "node_modules", name);
  if (!existsSync(src)) {
    if (required) {
      throw new Error(
        `[stage-packaged] required dep "${name}" not found at ${src}. Run \`npm install\` at the repo root.`
      );
    }
    console.warn(`[stage-packaged] optional dep "${name}" not found; skipping`);
    return;
  }
  const dest = path.join(OUT_NM, name);
  const moduleFilter = COPY_FILTERS[name];
  cpSync(src, dest, {
    recursive: true,
    filter: (s) => {
      const rel = path.relative(src, s);
      if (rel.split(path.sep).includes("node_modules")) return false;
      if (moduleFilter && !moduleFilter(rel, src)) return false;
      return true;
    },
  });
  console.log(`[stage-packaged] copied ${name}`);
}

async function main() {
  console.log(`[stage-packaged] cleaning ${path.relative(REPO_ROOT, OUT)}/`);
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT_NM, { recursive: true });

  console.log("[stage-packaged] esbuilding server.js");
  await build({
    entryPoints: [path.join(PKG_ROOT, "dist/server.js")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    outfile: path.join(OUT, "server.js"),
    external: [...NATIVE_MODULES, ...SQLITE_VEC_PACKAGES],
    // ESM bundle needs createRequire so `require` works for native modules
    // loaded from the co-located node_modules/.
    banner: {
      js: [
        "import { createRequire as __cr } from 'node:module';",
        "const require = __cr(import.meta.url);",
      ].join("\n"),
    },
    legalComments: "none",
    minify: false,
    sourcemap: false,
    logLevel: "info",
  });

  for (const mod of NATIVE_MODULES) copyModule(mod, /*required=*/ true);
  for (const mod of SQLITE_VEC_PACKAGES) {
    const required = mod === "sqlite-vec";
    copyModule(mod, required);
  }

  console.log(`[stage-packaged] done → ${path.relative(REPO_ROOT, OUT)}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
