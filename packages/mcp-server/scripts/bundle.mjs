#!/usr/bin/env node
/**
 * Bundles the Gistlist MCP server into `pack-staging/`, ready for `mcpb pack`.
 *
 * Outputs:
 *   pack-staging/manifest.json                  copied from ../manifest.json
 *   pack-staging/server.js                      esbuild bundle of dist/server.js
 *                                              + all JS deps (engine, sdk, zod, ...)
 *   pack-staging/node_modules/better-sqlite3/   native module, source-tree-copied
 *   pack-staging/node_modules/sqlite-vec/       JS shim
 *   pack-staging/node_modules/sqlite-vec-darwin-arm64/   .dylib (when present)
 *   pack-staging/node_modules/sqlite-vec-darwin-x64/     .dylib (when installed)
 *
 * Native modules can't be inlined into the JS bundle. They ship as-is and the
 * bundle requires them via NODE_PATH (set by the manifest's mcp_config.env).
 */
import { build } from "esbuild";
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(PKG_ROOT, "../..");
const STAGING = path.join(PKG_ROOT, "pack-staging");
const STAGING_NM = path.join(STAGING, "node_modules");

const NATIVE_MODULES = ["better-sqlite3"];
const SQLITE_VEC_PACKAGES = [
  "sqlite-vec",
  // Platform variants — only copy the ones that actually exist in the local
  // node_modules tree. CI matrix builds will populate both darwin variants.
  "sqlite-vec-darwin-arm64",
  "sqlite-vec-darwin-x64",
];

async function main() {
  console.log("[bundle] cleaning pack-staging/");
  if (existsSync(STAGING)) rmSync(STAGING, { recursive: true, force: true });
  mkdirSync(STAGING_NM, { recursive: true });

  console.log("[bundle] copying manifest.json");
  cpSync(path.join(PKG_ROOT, "manifest.json"), path.join(STAGING, "manifest.json"));

  console.log("[bundle] esbuilding server.js");
  await build({
    entryPoints: [path.join(PKG_ROOT, "dist/server.js")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    outfile: path.join(STAGING, "server.js"),
    // Native modules must remain external — they're loaded from node_modules
    // alongside the bundle at runtime.
    external: [
      ...NATIVE_MODULES,
      ...SQLITE_VEC_PACKAGES,
    ],
    // ESM bundling needs an explicit interop banner so `require` works for
    // native modules loaded via createRequire.
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

  for (const mod of NATIVE_MODULES) {
    copyModule(mod, /*required=*/ true);
  }
  for (const mod of SQLITE_VEC_PACKAGES) {
    // sqlite-vec base + arm64 are required on this dev machine; x64 is best-effort.
    const required = mod === "sqlite-vec";
    copyModule(mod, required);
  }

  // Strip platform binaries we know we don't need from better-sqlite3 to
  // shrink the bundle. better-sqlite3 ships only one .node per install, so
  // this is a no-op locally but useful documentation for CI matrix builds.
  trimBetterSqliteBinaries();

  const sizeMb = bundleSizeMb();
  console.log(`[bundle] pack-staging ready (${sizeMb.toFixed(1)} MB).`);
}

// Per-module copy filters: skip C/C++ source and build intermediates so the
// runtime bundle only carries what's needed to load and use the package.
const COPY_FILTERS = {
  "better-sqlite3": (rel) => {
    if (rel === "") return true;
    const parts = rel.split(path.sep);
    const top = parts[0];
    if (top === "node_modules") return false;
    if (top === "deps") return false; // sqlite C source amalgamation
    if (top === "src") return false; // C++ binding source
    if (rel === "binding.gyp") return false;
    if (top === "build") {
      // Only the runtime binary itself + the directory chain that contains it.
      if (rel === "build") return true;
      if (rel === path.join("build", "Release")) return true;
      if (rel === path.join("build", "Release", "better_sqlite3.node")) return true;
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
        `[bundle] required dep "${name}" not found at ${src}. Run \`npm install\` at the repo root.`
      );
    }
    console.warn(`[bundle] optional dep "${name}" not found; skipping`);
    return;
  }
  const dest = path.join(STAGING_NM, name);
  const moduleFilter = COPY_FILTERS[name];
  cpSync(src, dest, {
    recursive: true,
    filter: (s) => {
      const rel = path.relative(src, s);
      // Always skip nested node_modules.
      if (rel.split(path.sep).includes("node_modules")) return false;
      if (moduleFilter && !moduleFilter(rel)) return false;
      return true;
    },
  });
  console.log(`[bundle] copied ${name}`);
}

function trimBetterSqliteBinaries() {
  // No-op for now — better-sqlite3 only writes its own ABI's .node into
  // build/Release/. CI can extend this if it cross-compiles for multiple
  // ABIs into the same staging dir.
}

function bundleSizeMb() {
  const out = execSync(`du -sk "${STAGING}"`, { encoding: "utf-8" }).trim();
  const kb = Number(out.split(/\s+/)[0]);
  return kb / 1024;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
