#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import matter from "gray-matter";

const args = process.argv.slice(2);
const runFolder =
  valueAfter("--run-folder") ?? process.env.GISTLIST_DUPLICATE_REGRESSION_RUN_FOLDER;

if (!runFolder) {
  console.log("Skipping duplicate-speaker regression: pass --run-folder or set GISTLIST_DUPLICATE_REGRESSION_RUN_FOLDER.");
  process.exit(0);
}

const sourceRun = path.resolve(runFolder);
if (!fs.existsSync(path.join(sourceRun, "index.md"))) {
  console.error(`Run folder is missing index.md: ${sourceRun}`);
  process.exit(1);
}

const engine = await import("@gistlist/engine");
const transcriptCore = await import("@gistlist/engine/core/transcript.js");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gistlist-duplicate-regression-"));
const tempRun = path.join(tempRoot, "Runs", path.basename(sourceRun));
const logPath = path.join(os.tmpdir(), `gistlist-duplicate-regression-${process.pid}-${Date.now()}.log`);
fs.mkdirSync(path.dirname(tempRun), { recursive: true });
fs.cpSync(sourceRun, tempRun, { recursive: true });

let keepLog = false;
try {
  const config = engine.loadConfig();
  config.data_path = tempRoot;
  config.audio_storage_mode = "full-fidelity";

  const manifest = engine.loadRunManifest(tempRun);
  const audioFiles = collectRunAudioFiles(tempRun, manifest.source_mode);
  if (audioFiles.length === 0) {
    throw new Error("Copied run has no usable audio files.");
  }

  const logger = engine.createRunLogger(logPath, true);
  await engine.processRun({
    config,
    runFolder: tempRun,
    title: manifest.title,
    date: manifest.date,
    audioFiles,
    logger,
    onlyIds: [],
  });

  const transcriptPath = path.join(tempRun, "transcript.md");
  const md = matter(fs.readFileSync(transcriptPath, "utf-8")).content;
  const segments = engine.parseTranscriptMarkdown(md);
  const candidates = transcriptCore.findDuplicateSpeakerSegments({
    segments,
    fullText: segments.map((s) => s.text).join(" "),
    provider: "regression",
    durationMs: segments.reduce((max, s) => Math.max(max, s.end_ms), 0),
  });

  if (candidates.length > 0) {
    keepLog = true;
    console.error(`Duplicate speaker regression failed: ${candidates.length} candidates remain.`);
    for (const candidate of candidates.slice(0, 20)) {
      console.error(
        `- ${fmt(candidate.me.start_ms)} Me="${candidate.me.text.slice(0, 120)}" :: Others="${candidate.others
          .map((s) => s.text)
          .join(" ")
          .slice(0, 120)}" (${candidate.reason}, ${candidate.score.toFixed(2)})`
      );
    }
    console.error(`Regression log: ${logPath}`);
    process.exitCode = 1;
  } else {
    console.log("Duplicate speaker regression passed: zero candidates remain.");
  }
} catch (err) {
  keepLog = true;
  console.error(`Duplicate speaker regression errored: ${err instanceof Error ? err.message : String(err)}`);
  console.error(`Regression log: ${logPath}`);
  process.exitCode = 1;
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  if (!keepLog) {
    fs.rmSync(logPath, { force: true });
  }
}

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function collectRunAudioFiles(runFolder, sourceMode) {
  const audioDir = path.join(runFolder, "audio");
  if (!fs.existsSync(audioDir)) return [];
  const files = [];
  const firstExisting = (dir, names) => {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  };
  const addFromDir = (dir) => {
    const mic = firstExisting(dir, ["mic.wav", "mic.ogg", "mic.flac"]);
    const system = firstExisting(dir, ["system.wav", "system.ogg", "system.flac"]);
    if (mic) files.push({ path: mic, speaker: "me" });
    if (system) files.push({ path: system, speaker: "others" });
  };

  const segmentDirs = fs
    .readdirSync(audioDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const segment of segmentDirs) addFromDir(path.join(audioDir, segment.name));
  if (files.length > 0) return files;
  addFromDir(audioDir);
  if (files.length > 0) return files;

  const loose = fs
    .readdirSync(audioDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(audioDir, entry.name));
  if (sourceMode === "file" && loose.length > 0) {
    return [{ path: loose[0], speaker: "unknown" }];
  }
  return loose.map((audioPath) => ({ path: audioPath, speaker: "unknown" }));
}

function fmt(ms) {
  const sec = Math.floor(ms / 1000);
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}
