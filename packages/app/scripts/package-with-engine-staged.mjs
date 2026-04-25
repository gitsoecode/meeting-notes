#!/usr/bin/env node
/**
 * Packaging wrapper that swaps the workspace-symlinked
 * `@gistlist/engine` for a real on-disk copy *only* for the duration
 * of an `electron-builder --mac` run.
 *
 * Why it exists:
 *   electron-builder's asar pipeline calls `getRelativePath(file, appDir)`
 *   on every file in the bundle, which throws for any file whose real
 *   path isn't under `packages/app/`. With workspace symlinks like
 *   `node_modules/@gistlist/engine -> ../../packages/engine`, every
 *   engine source file blows up that check — even ones that don't
 *   match the asarUnpack pattern. The path validator can't be
 *   skipped from config; the only fix is to make the engine look like
 *   a normal installed dep at the moment electron-builder runs.
 *
 * What it does (try/finally — never leaves the tree dirty):
 *   1. Detect whether `node_modules/@gistlist/engine` is a symlink.
 *   2. If yes: record the link target, remove the symlink, and copy
 *      a minimal runtime-shaped tree there:
 *        - `package.json`
 *        - `dist/**` (compiled JS — the engine's actual runtime)
 *        - `LICENSE` and `README.md` if they exist
 *      Source `.ts`, tests, tsconfig, and dev metadata are
 *      intentionally NOT copied — the .app doesn't need them.
 *   3. Run `electron-builder` with whatever args were passed in.
 *   4. In a finally block, ALWAYS restore the original symlink so
 *      future `npm run dev` / `npm test` runs see workspace edits
 *      again. Failure during packaging never leaves the staged copy
 *      shadowing the workspace.
 *
 * Forwards process.argv tail to electron-builder so callers can pass
 * --mac, --config.foo=bar, etc.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_PKG_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(APP_PKG_ROOT, "..", "..");

// In this monorepo npm hoists workspace deps to the repo-root
// `node_modules/`, so the symlink lives there rather than under
// `packages/app/node_modules/`. electron-builder still finds it via
// node's standard upward resolution.
const ENGINE_LINK = path.join(
  REPO_ROOT,
  "node_modules",
  "@gistlist",
  "engine"
);
const ENGINE_SOURCE = path.join(REPO_ROOT, "packages", "engine");

/**
 * Copy a minimal runtime shape from packages/engine into the staged
 * location. Keeps the same files real-world `npm install` would
 * install — no source, no tests, no tsconfig.
 */
function stageEngineCopy(dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.mkdirSync(dest);

  // package.json — the actual entry point manifest
  fs.copyFileSync(
    path.join(ENGINE_SOURCE, "package.json"),
    path.join(dest, "package.json")
  );

  // dist/** — the compiled runtime that the app actually loads
  copyDirRecursive(
    path.join(ENGINE_SOURCE, "dist"),
    path.join(dest, "dist")
  );

  // Licenses / readmes if present (good citizenship; never required).
  for (const f of ["LICENSE", "README.md"]) {
    const src = path.join(ENGINE_SOURCE, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(dest, f));
    }
  }
}

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    throw new Error(
      `[package-with-engine-staged] expected ${src} to exist — did you run \`npm run build --workspace @gistlist/engine\` first?`
    );
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(s, d);
    } else if (entry.isSymbolicLink()) {
      // Resolve and copy as a real file — staged tree must be self-contained.
      const real = fs.realpathSync(s);
      fs.copyFileSync(real, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

/**
 * Restore the original symlink. Idempotent.
 *  - If the staged dir exists at ENGINE_LINK: rm it.
 *  - Recreate the symlink pointing at packages/engine (relative).
 */
function restoreSymlink(originalLinkTarget) {
  try {
    const st = fs.lstatSync(ENGINE_LINK);
    if (st.isSymbolicLink()) {
      // Already a symlink — nothing to restore. Could happen on a
      // re-run before we replaced it.
      return;
    }
    // Real directory shadowing the workspace — remove it.
    fs.rmSync(ENGINE_LINK, { recursive: true, force: true });
  } catch {
    // Doesn't exist — proceed to create.
  }
  fs.mkdirSync(path.dirname(ENGINE_LINK), { recursive: true });
  fs.symlinkSync(originalLinkTarget, ENGINE_LINK, "dir");
}

function main() {
  // Forward argv tail to electron-builder.
  const builderArgs = process.argv.slice(2);

  // 1. Detect current state of the engine link.
  let originalLinkTarget = null;
  let hadSymlink = false;
  try {
    const st = fs.lstatSync(ENGINE_LINK);
    if (st.isSymbolicLink()) {
      originalLinkTarget = fs.readlinkSync(ENGINE_LINK);
      hadSymlink = true;
      console.log(
        `[package-with-engine-staged] found workspace symlink: ${ENGINE_LINK} -> ${originalLinkTarget}`
      );
    } else {
      console.log(
        `[package-with-engine-staged] ${ENGINE_LINK} is already a real directory — leaving as-is`
      );
    }
  } catch {
    throw new Error(
      `[package-with-engine-staged] ${ENGINE_LINK} does not exist. Run \`npm install\` first.`
    );
  }

  // 2. Stage the engine copy (only when we found a symlink to replace).
  if (hadSymlink) {
    fs.unlinkSync(ENGINE_LINK);
    try {
      stageEngineCopy(ENGINE_LINK);
      console.log(
        `[package-with-engine-staged] staged engine copy at ${ENGINE_LINK} (package.json + dist/**)`
      );
    } catch (err) {
      // Restore symlink on staging failure too.
      console.error(
        `[package-with-engine-staged] staging failed: ${err.message}`
      );
      restoreSymlink(originalLinkTarget);
      process.exit(1);
    }
  }

  // 3. Run electron-builder. Always restore in finally.
  let exitCode = 0;
  try {
    const builderBin = path.join(
      REPO_ROOT,
      "node_modules",
      ".bin",
      "electron-builder"
    );
    const result = spawnSyncWithLog(builderBin, builderArgs);
    exitCode = result.status ?? 1;
  } catch (err) {
    console.error(
      `[package-with-engine-staged] electron-builder error: ${err.message}`
    );
    exitCode = 1;
  } finally {
    if (hadSymlink) {
      try {
        restoreSymlink(originalLinkTarget);
        console.log(
          `[package-with-engine-staged] restored workspace symlink: ${ENGINE_LINK} -> ${originalLinkTarget}`
        );
      } catch (restoreErr) {
        console.error(
          `[package-with-engine-staged] FAILED TO RESTORE SYMLINK: ${restoreErr.message}`
        );
        console.error(
          `  Manual fix: rm -rf ${ENGINE_LINK} && ln -s ../../../packages/engine ${ENGINE_LINK}`
        );
        // Still exit non-zero so the user sees something is wrong.
        exitCode = exitCode || 1;
      }
    }
  }

  process.exit(exitCode);
}

/** Lightweight wrapper so we get inherited stdio + the exit code. */
function spawnSyncWithLog(cmd, args) {
  console.log(
    `[package-with-engine-staged] running: ${cmd} ${args.join(" ")}`
  );
  return spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: APP_PKG_ROOT,
  });
}

main();
