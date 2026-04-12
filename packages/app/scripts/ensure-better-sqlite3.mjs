import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const appRoot = path.resolve(__dirname, "..");

function canLoadBetterSqlite3() {
  const probe = spawnSync(
    process.execPath,
    ["-e", "const D = require('better-sqlite3'); new D(':memory:').close();"],
    {
      cwd: appRoot,
      env: process.env,
      encoding: "utf8",
    }
  );

  return {
    ok: probe.status === 0,
    stderr: probe.stderr ?? "",
    stdout: probe.stdout ?? "",
  };
}

function rebuildBetterSqlite3() {
  const npmExecPath = process.env.npm_execpath;
  const env = {
    ...process.env,
    PYTHON: "/usr/bin/python3",
  };

  if (npmExecPath) {
    return spawnSync(
      process.execPath,
      [npmExecPath, "rebuild", "better-sqlite3", "--workspace", "@meeting-notes/app"],
      {
        cwd: repoRoot,
        env,
        stdio: "inherit",
      }
    );
  }

  return spawnSync(
    "npm",
    ["rebuild", "better-sqlite3", "--workspace", "@meeting-notes/app"],
    {
      cwd: repoRoot,
      env,
      stdio: "inherit",
    }
  );
}

const initialProbe = canLoadBetterSqlite3();
if (initialProbe.ok) {
  process.exit(0);
}

const knownNativeLoadFailure =
  initialProbe.stderr.includes("ERR_DLOPEN_FAILED") ||
  initialProbe.stderr.includes("NODE_MODULE_VERSION") ||
  initialProbe.stderr.includes("better_sqlite3.node") ||
  initialProbe.stderr.includes("Cannot find module 'better-sqlite3'");

if (!knownNativeLoadFailure) {
  process.stderr.write(initialProbe.stderr || initialProbe.stdout);
  process.exit(1);
}

console.log("Repairing better-sqlite3 test binary for the current Node runtime...");
const rebuild = rebuildBetterSqlite3();
if (rebuild.status !== 0) {
  process.exit(rebuild.status ?? 1);
}

const finalProbe = canLoadBetterSqlite3();
if (!finalProbe.ok) {
  process.stderr.write(finalProbe.stderr || finalProbe.stdout);
  process.exit(1);
}
