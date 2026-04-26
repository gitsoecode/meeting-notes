#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import matter from "gray-matter";
import { parse as parseYaml } from "yaml";

const execFileAsync = promisify(execFile);
const engine = await import("@gistlist/engine");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const mode = valueAfter("--mode") ?? "compact";
const singleRunFolder = valueAfter("--run-folder");

if (!["compact", "lossless"].includes(mode)) {
  fail("--mode must be compact or lossless");
}

await assertTools(mode);

const config = loadConfig();
const runsRoot = path.join(config.data_path.replace(/^~/, os.homedir()), "Runs");
const runFolders = singleRunFolder ? [path.resolve(singleRunFolder)] : findRunFolders(runsRoot);

let eligible = 0;
let compacted = 0;
let skipped = 0;
let failed = 0;
let beforeBytes = 0;
let projectedBytes = 0;

for (const runFolder of runFolders) {
  const plan = inspectRun(runFolder, mode);
  if (!plan.eligible) {
    skipped += 1;
    console.log(`skip ${runFolder}: ${plan.reason}`);
    continue;
  }

  eligible += 1;
  beforeBytes += plan.beforeBytes;
  projectedBytes += plan.projectedBytes;
  console.log(
    `${apply ? "compact" : "would compact"} ${runFolder}: ${formatBytes(plan.beforeBytes)} -> ~${formatBytes(plan.projectedBytes)}`
  );

  if (!apply) continue;
  try {
    for (const item of plan.items) {
      await encodeArchive(item.input, item.output, item.kind, item.bitrateKbps);
      fs.rmSync(item.input, { force: true });
    }
    compacted += 1;
  } catch (err) {
    failed += 1;
    console.error(`failed ${runFolder}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log("");
console.log(`${apply ? "Compacted" : "Eligible"}: ${apply ? compacted : eligible}`);
console.log(`Skipped: ${skipped}`);
if (apply) console.log(`Failed: ${failed}`);
console.log(`Estimated savings: ${formatBytes(Math.max(0, beforeBytes - projectedBytes))}`);
if (!apply) console.log("Dry run only. Re-run with --apply to rewrite audio files.");

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function loadConfig() {
  const configDir = process.env.GISTLIST_CONFIG_DIR || path.join(os.homedir(), ".gistlist");
  const configPath = path.join(configDir, "config.yaml");
  if (!fs.existsSync(configPath)) fail(`Config not found at ${configPath}`);
  return parseYaml(fs.readFileSync(configPath, "utf-8"));
}

function findRunFolders(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const walk = (dir) => {
    if (fs.existsSync(path.join(dir, "index.md"))) {
      out.push(dir);
      return;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
    }
  };
  walk(root);
  return out;
}

function inspectRun(runFolder, targetMode) {
  const indexPath = path.join(runFolder, "index.md");
  if (!fs.existsSync(indexPath)) return { eligible: false, reason: "missing index.md" };
  const manifest = matter(fs.readFileSync(indexPath, "utf-8")).data;
  if (["draft", "recording", "paused", "processing"].includes(manifest.status)) {
    return { eligible: false, reason: `status ${manifest.status}` };
  }

  const audioDir = path.join(runFolder, "audio");
  if (!fs.existsSync(audioDir)) return { eligible: false, reason: "no audio directory" };

  const items = [];
  for (const filePath of listAudioFiles(audioDir)) {
    const base = path.basename(filePath);
    const dir = path.dirname(filePath);
    if (base === "combined.wav") {
      items.push({
        input: filePath,
        output: path.join(dir, "combined.ogg"),
        kind: "ogg",
        bitrateKbps: 32,
      });
    } else if (base === "mic.wav" || base === "system.wav") {
      const stem = path.basename(base, ".wav");
      if (targetMode === "lossless") {
        items.push({ input: filePath, output: path.join(dir, `${stem}.flac`), kind: "flac" });
      } else {
        items.push({
          input: filePath,
          output: path.join(dir, `${stem}.ogg`),
          kind: "ogg",
          bitrateKbps: 48,
        });
      }
    }
  }

  if (items.length === 0) return { eligible: false, reason: "no generated WAV files to compact" };
  const beforeBytes = items.reduce((sum, item) => sum + fs.statSync(item.input).size, 0);
  const projectedRatio = targetMode === "lossless" ? 0.42 : 0.08;
  const projectedBytes = Math.round(beforeBytes * projectedRatio);
  return { eligible: true, items, beforeBytes, projectedBytes };
}

function listAudioFiles(audioDir) {
  const out = [];
  for (const entry of fs.readdirSync(audioDir, { withFileTypes: true })) {
    const full = path.join(audioDir, entry.name);
    if (entry.isFile()) out.push(full);
    else if (entry.isDirectory() && !entry.name.startsWith(".")) {
      for (const child of fs.readdirSync(full, { withFileTypes: true })) {
        if (child.isFile()) out.push(path.join(full, child.name));
      }
    }
  }
  return out;
}

async function assertTools(targetMode) {
  try {
    await execFileAsync("ffmpeg", ["-hide_banner", "-version"]);
    await execFileAsync("ffprobe", ["-hide_banner", "-version"]);
    const { stdout } = await execFileAsync("ffmpeg", ["-hide_banner", "-encoders"]);
    if (!stdout.includes("libopus")) fail("ffmpeg does not include libopus encoder support");
    if (targetMode === "lossless" && !stdout.includes(" flac")) {
      fail("ffmpeg does not include flac encoder support");
    }
  } catch (err) {
    fail(`ffmpeg/ffprobe check failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function encodeArchive(input, output, kind, bitrateKbps) {
  await engine.encodeAudioArchive(
    input,
    output,
    kind === "flac" ? "flac" : "ogg-opus",
    bitrateKbps ? { bitrateKbps } : {}
  );
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unit]}`;
}

if (apply && failed > 0) {
  process.exitCode = 1;
}
