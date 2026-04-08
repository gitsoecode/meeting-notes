#!/usr/bin/env node

import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import matter from "gray-matter";
import {
  loadConfig,
  saveConfig,
  getConfigPath,
  getAppLogPath,
  resolveBasePath,
  DEFAULT_CONFIG,
  type AppConfig,
  getSecret,
  setSecret,
  hasSecret,
  requireSecret,
  SECRET_LABELS,
  type SecretName,
  initProject,
  createRun,
  updateRunStatus,
  loadRunManifest,
  processRun,
  createAppLogger,
  createRunLogger,
  loadAllPrompts,
  updatePromptFrontmatter,
  resetDefaultPrompts,
  getPromptsDir,
  DEFAULT_PROMPTS_DIR,
  getAudioInfo,
  FfmpegRecorder,
  saveActiveRecording,
  loadActiveRecording,
  clearActiveRecording,
  isProcessAlive,
  stopRecordingProcesses,
  openInObsidian,
  setupAsr,
  moveDataDirectory,
} from "@meeting-notes/engine";
import { createPrompter } from "./prompt.js";

/**
 * Wait for the user to press Enter (resolves "enter") or send SIGINT
 * via Ctrl-C (resolves "sigint"). Uses readline in line mode so the
 * cursor stays visible and pasting works normally.
 */
function waitForStopSignal(): Promise<"enter" | "sigint"> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let settled = false;
    const finish = (reason: "enter" | "sigint") => {
      if (settled) return;
      settled = true;
      rl.removeListener("line", onLine);
      rl.removeListener("SIGINT", onSigint);
      rl.close();
      resolve(reason);
    };
    const onLine = () => finish("enter");
    const onSigint = () => finish("sigint");
    rl.on("line", onLine);
    // readline intercepts Ctrl-C and emits 'SIGINT' on the rl instance
    // instead of letting it kill the process. Listening here is what
    // gives us the abort path.
    rl.on("SIGINT", onSigint);
  });
}

interface RunProcessingPipelineOpts {
  config: AppConfig;
  active: {
    run_folder: string;
    title: string;
    mic_path?: string;
    system_path?: string;
    system_captured: boolean;
  };
  logger: import("@meeting-notes/engine").Logger;
  autoOnly: boolean;
}

/**
 * Shared post-recording pipeline used by both `start` (Enter pressed)
 * and `stop`. Verifies captured audio, logs durations, runs processRun,
 * and prints results. Returns true on success (or partial success), false
 * if no audio was captured.
 */
async function runProcessingPipeline(opts: RunProcessingPipelineOpts): Promise<boolean> {
  const { config, active, logger, autoOnly } = opts;

  const audioFiles: { path: string; speaker: "me" | "others" | "unknown" }[] = [];
  if (active.mic_path && fs.existsSync(active.mic_path) && fs.statSync(active.mic_path).size > 0) {
    audioFiles.push({ path: active.mic_path, speaker: active.system_captured ? "me" : "unknown" });
  }
  if (active.system_path && fs.existsSync(active.system_path) && fs.statSync(active.system_path).size > 0) {
    audioFiles.push({ path: active.system_path, speaker: "others" });
  }

  if (audioFiles.length === 0) {
    console.error("  No audio captured. Aborting processing.");
    logger.error("No audio captured");
    updateRunStatus(active.run_folder, "error", { ended: new Date().toISOString() });
    return false;
  }

  for (const af of audioFiles) {
    try {
      const info = await getAudioInfo(af.path);
      logger.info("Recorded audio", {
        path: path.basename(af.path),
        speaker: af.speaker,
        durationMs: info.durationMs,
      });
    } catch {
      // ignore
    }
  }

  const manifest = loadRunManifest(active.run_folder);
  console.log("  Processing...");

  try {
    const { succeeded, failed } = await processRun({
      config,
      runFolder: active.run_folder,
      title: active.title,
      date: manifest.date,
      audioFiles,
      logger,
      autoOnly,
    });

    console.log(`  Pipeline: ${succeeded.length} succeeded, ${failed.length} failed`);
    for (const id of succeeded) console.log(`    ✓ ${id}`);
    for (const id of failed) console.error(`    ✗ ${id}`);
    console.log(`\n  Run folder: ${active.run_folder}\n`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  Processing failed: ${msg}`);
    return false;
  }
}

const program = new Command();

program
  .name("meeting-notes")
  .description("Local-first meeting recording and processing with Obsidian integration")
  .version("0.1.0");

// --- init ---
program
  .command("init")
  .description("Interactive setup — configure data directory, Obsidian integration, and API keys")
  .action(async () => {
    const prompter = createPrompter();

    console.log("\n  Meeting Notes — Setup\n");

    const dataPathInput = await prompter.ask(
      "Data directory (where meeting runs are stored)",
      DEFAULT_CONFIG.data_path.replace(os.homedir(), "~")
    );
    const dataPath = dataPathInput.replace(/^~/, os.homedir());

    const obsidianYn = (
      await prompter.ask(
        "Enable Obsidian integration? (opens notes in Obsidian when recording) (y/N)",
        "N"
      )
    ).toLowerCase();
    const obsidianEnabled = obsidianYn === "y" || obsidianYn === "yes";

    let obsidianVaultPath: string | undefined;
    let obsidianVaultName: string | undefined;
    if (obsidianEnabled) {
      const vaultPathInput = await prompter.ask(
        "  Obsidian vault path (the vault that contains the data directory)",
        path.dirname(dataPath)
      );
      obsidianVaultPath = vaultPathInput.replace(/^~/, os.homedir());
      obsidianVaultName = path.basename(obsidianVaultPath);
    }

    const asrProvider = await prompter.ask(
      "ASR provider (parakeet-mlx, openai, or whisper-local)",
      DEFAULT_CONFIG.asr_provider
    );
    const micDevice = await prompter.ask("Microphone device (AVFoundation name)", DEFAULT_CONFIG.recording.mic_device);
    const systemDevice = await prompter.ask("System audio device (e.g., BlackHole 2ch)", DEFAULT_CONFIG.recording.system_device);

    const normalizedAsr: AppConfig["asr_provider"] =
      asrProvider === "whisper-local"
        ? "whisper-local"
        : asrProvider === "openai"
          ? "openai"
          : "parakeet-mlx";

    // --- API keys → macOS Keychain ---
    console.log("\n  API keys (stored in macOS Keychain under service 'meeting-notes')");

    const keysToCollect: SecretName[] = ["claude"];
    if (normalizedAsr === "openai") keysToCollect.push("openai");

    for (const name of keysToCollect) {
      const label = SECRET_LABELS[name];
      const exists = await hasSecret(name);
      if (exists) {
        const replace = (await prompter.ask(`  ${label} API key already in Keychain. Replace? (y/N)`, "N")).toLowerCase();
        if (replace !== "y" && replace !== "yes") {
          console.log(`    Keeping existing ${label} key.`);
          continue;
        }
      }
      const key = await prompter.askHidden(`  ${label} API key (paste, hidden — leave blank to skip)`);
      if (key) {
        await setSecret(name, key);
        console.log(`    Stored ${label} key in macOS Keychain.`);
      } else {
        console.log(`    Skipped ${label} key.`);
      }
    }

    prompter.close();

    const config: AppConfig = {
      data_path: dataPath,
      obsidian_integration: {
        enabled: obsidianEnabled,
        vault_name: obsidianVaultName,
        vault_path: obsidianVaultPath,
      },
      asr_provider: normalizedAsr,
      llm_provider: "claude",
      whisper_local: DEFAULT_CONFIG.whisper_local,
      parakeet_mlx: DEFAULT_CONFIG.parakeet_mlx,
      claude: DEFAULT_CONFIG.claude,
      recording: { mic_device: micDevice, system_device: systemDevice },
      shortcuts: DEFAULT_CONFIG.shortcuts,
    };

    initProject(config, {
      onMessage: (msg) => console.log(msg),
    });

    console.log(`\n  Config saved to: ${getConfigPath()}`);
    console.log(`  Data folder:     ${resolveBasePath(config)}`);
    console.log(`  Dashboard:       ${path.join(resolveBasePath(config), "Dashboard.md")}`);
    if (normalizedAsr === "parakeet-mlx") {
      console.log(`\n  Next step: run 'meeting-notes setup-asr' to install Parakeet.`);
    }
    if (obsidianEnabled) {
      console.log(`\n  Open your Obsidian vault and install the Dataview plugin for dashboard queries.\n`);
    } else {
      console.log(`\n  Obsidian integration is off. You can turn it on later with 'meeting-notes config obsidian enable'.\n`);
    }
  });

// --- set-key ---
program
  .command("set-key <provider>")
  .description("Store or rotate an API key in macOS Keychain (provider: claude | openai)")
  .action(async (provider: string) => {
    if (provider !== "claude" && provider !== "openai") {
      console.error(`  Unknown provider "${provider}". Use "claude" or "openai".`);
      process.exit(1);
    }
    const name = provider as SecretName;
    const label = SECRET_LABELS[name];
    const prompter = createPrompter();
    try {
      const existing = await getSecret(name);
      if (existing) {
        console.log(`  ${label} key already exists in Keychain — it will be replaced.`);
      }
      const key = await prompter.askHidden(`  ${label} API key (paste, hidden)`);
      if (!key) {
        console.log("  Empty input — no changes made.");
        return;
      }
      await setSecret(name, key);
      console.log(`  Stored ${label} key in macOS Keychain (service: meeting-notes).`);
    } finally {
      prompter.close();
    }
  });

// --- setup-asr ---
program
  .command("setup-asr")
  .description("Install Parakeet (mlx-audio) into an isolated venv and wire it into config")
  .option("--force", "Remove any existing venv before installing")
  .action(async (opts: { force?: boolean }) => {
    try {
      await setupAsr({ force: opts.force, onLog: (line) => console.log(line) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n  ✗ setup-asr failed:\n${msg}\n`);
      process.exit(1);
    }
  });

// --- start ---
program
  .command("start")
  .description("Start recording a meeting (mic + system audio)")
  .option("-t, --title <title>", "Meeting title", "Untitled Meeting")
  .action(async (opts: { title: string }) => {
    const config = loadConfig();
    const appLogger = createAppLogger(true);

    // Check for existing recording
    const existing = loadActiveRecording();
    if (existing && existing.pids.some((p) => isProcessAlive(p))) {
      console.error(`  Recording already in progress: ${existing.title}`);
      console.error(`  Run "meeting-notes stop" to finish it first.`);
      process.exit(1);
    }
    if (existing) {
      // Stale state file
      clearActiveRecording();
    }

    const run = createRun(config, opts.title, "both");
    appLogger.info("Starting recording", { run_id: run.manifest.run_id, title: opts.title });

    // Start ffmpeg recording
    const recorder = new FfmpegRecorder();
    const session = await recorder.start({
      micDevice: config.recording.mic_device,
      systemDevice: config.recording.system_device,
      outputDir: path.join(run.folderPath, "audio"),
    });

    saveActiveRecording({
      run_id: run.manifest.run_id,
      run_folder: run.folderPath,
      title: opts.title,
      started_at: run.manifest.started,
      pids: session.pids,
      mic_path: session.paths.mic,
      system_path: session.paths.system,
      system_captured: session.systemCaptured,
    });

    run.logger.info("Recording started", {
      pids: session.pids,
      mic_path: session.paths.mic,
      system_path: session.paths.system,
      system_captured: session.systemCaptured,
    });

    console.log(`\n  Recording: ${opts.title}`);
    console.log(`  Run:       ${run.folderPath}`);
    console.log(`  Mic:       ${config.recording.mic_device}`);
    if (session.systemCaptured) {
      console.log(`  System:    ${config.recording.system_device}`);
    } else {
      console.log(`  System:    not available (${config.recording.system_device}) — mic only`);
      run.logger.warn("System audio capture unavailable, mic only", {
        device: config.recording.system_device,
      });
    }
    console.log(`\n  ▶ Press Enter to stop and process.   (Ctrl-C to abort without processing.)\n`);

    // Fire-and-forget — don't block on Obsidian
    void openInObsidian(config, path.join(run.folderPath, "notes.md"));

    // Wait for Enter (stop+process) or Ctrl-C (abort)
    const reason = await waitForStopSignal();

    console.log(reason === "enter" ? "  Stopping..." : "  Aborting...");
    run.logger.info("Stop signal received", { reason });

    // Stop ffmpeg cleanly (SIGINT → flush → wait → force-kill stragglers)
    await session.stop();
    clearActiveRecording();

    if (reason === "sigint") {
      updateRunStatus(run.folderPath, "aborted", { ended: new Date().toISOString() });
      console.log(
        `\n  Aborted. Audio is in ${run.folderPath} — run "meeting-notes process <audio-file>" later if you want to transcribe it.\n`
      );
      return;
    }

    await runProcessingPipeline({
      config,
      active: {
        run_folder: run.folderPath,
        title: opts.title,
        mic_path: session.paths.mic,
        system_path: session.paths.system,
        system_captured: session.systemCaptured,
      },
      logger: run.logger,
      autoOnly: true,
    });
  });

// --- stop ---
program
  .command("stop")
  .description("Stop active recording and auto-process")
  .option("--no-process", "Stop recording but skip processing")
  .option("--all", "Run every enabled prompt, including manual ones")
  .action(async (opts: { process: boolean; all?: boolean }) => {
    const config = loadConfig();
    const appLogger = createAppLogger(true);

    const active = loadActiveRecording();
    if (!active) {
      console.error("  No active recording.");
      process.exit(1);
    }

    appLogger.info("Stopping recording", { run_id: active.run_id });

    const logger = createRunLogger(path.join(active.run_folder, "run.log"), true);

    // Send SIGINT to ffmpeg processes so they flush WAV
    stopRecordingProcesses(active.pids);
    logger.info("Sent SIGINT to recording processes", { pids: active.pids });

    // Wait briefly for processes to exit
    const maxWaitMs = 5000;
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (active.pids.every((p) => !isProcessAlive(p))) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    // Force-kill any stragglers
    for (const pid of active.pids) {
      if (isProcessAlive(pid)) {
        try {
          process.kill(pid, "SIGKILL");
          logger.warn("Force-killed straggler process", { pid });
        } catch {
          // ignore
        }
      }
    }

    clearActiveRecording();
    console.log(`  Recording stopped: ${active.title}`);

    if (!opts.process) {
      console.log("  Skipping processing (--no-process).");
      updateRunStatus(active.run_folder, "complete", { ended: new Date().toISOString() });
      return;
    }

    await runProcessingPipeline({
      config,
      active: {
        run_folder: active.run_folder,
        title: active.title,
        mic_path: active.mic_path,
        system_path: active.system_path,
        system_captured: active.system_captured,
      },
      logger,
      autoOnly: !opts.all,
    });
  });

// --- status ---
program
  .command("status")
  .description("Show active recording status")
  .action(() => {
    const active = loadActiveRecording();
    if (!active) {
      console.log("  No active recording.");
      return;
    }

    const alive = active.pids.filter((p) => isProcessAlive(p));
    if (alive.length === 0) {
      console.log(`  Stale state: recording for "${active.title}" appears to have died.`);
      console.log(`  Run "meeting-notes stop" to clean up and process anyway.`);
      return;
    }

    const startedMs = Date.now() - new Date(active.started_at).getTime();
    const minutes = Math.floor(startedMs / 60000);
    const seconds = Math.floor((startedMs % 60000) / 1000);

    console.log(`  Recording: ${active.title}`);
    console.log(`  Duration:  ${minutes}m ${seconds}s`);
    console.log(`  PIDs:      ${alive.join(", ")}`);
    console.log(`  System:    ${active.system_captured ? "captured" : "mic only"}`);
    console.log(`  Folder:    ${active.run_folder}`);
  });

// --- process ---
program
  .command("process <audio-file>")
  .description("Process an existing audio file — create run, transcribe, and run LLM pipeline")
  .option("-t, --title <title>", "Meeting title", "Untitled Meeting")
  .option("--all", "Run every enabled prompt, including manual ones")
  .action(async (audioFile: string, opts: { title: string; all?: boolean }) => {
    const config = loadConfig();
    const appLogger = createAppLogger(true);

    const resolvedAudio = path.resolve(audioFile);
    if (!fs.existsSync(resolvedAudio)) {
      console.error(`Audio file not found: ${resolvedAudio}`);
      process.exit(1);
    }

    appLogger.info("Processing audio file", { file: resolvedAudio, title: opts.title });

    const run = createRun(config, opts.title, "file");
    console.log(`\n  Run created: ${run.folderPath}`);

    // Copy audio into run folder
    const audioDest = path.join(run.folderPath, "audio", path.basename(resolvedAudio));
    fs.copyFileSync(resolvedAudio, audioDest);
    run.logger.info("Audio file copied", { dest: audioDest });

    try {
      const info = await getAudioInfo(resolvedAudio);
      console.log(`  Audio: ${Math.round(info.durationMs / 1000)}s, ${info.sampleRate}Hz, ${info.channels}ch`);
    } catch {
      // ignore
    }

    console.log("  Processing...");
    try {
      const { succeeded, failed } = await processRun({
        config,
        runFolder: run.folderPath,
        title: opts.title,
        date: run.manifest.date,
        audioFiles: [{ path: audioDest, speaker: "unknown" }],
        logger: run.logger,
        autoOnly: !opts.all,
      });

      console.log(`  Pipeline: ${succeeded.length} succeeded, ${failed.length} failed`);
      for (const id of succeeded) console.log(`    ✓ ${id}`);
      for (const id of failed) console.error(`    ✗ ${id}`);
      console.log(`\n  Run folder: ${run.folderPath}\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  Processing failed: ${msg}`);
    }
  });

// --- reprocess ---
program
  .command("reprocess <run-path>")
  .description("Re-run LLM pipeline on an existing run (picks up updated notes)")
  .option("--only <ids>", "Comma-separated section ids to run (bypasses auto filter)")
  .option("--failed", "Only re-run sections currently in failed state")
  .option("--skip-complete", "Skip sections already marked complete")
  .option("--all", "Run every enabled prompt, including manual ones")
  .option("--max-attempts <n>", "Max retry attempts per section", "3")
  .action(async (runPath: string, opts: { only?: string; failed?: boolean; skipComplete?: boolean; all?: boolean; maxAttempts: string }) => {
    const config = loadConfig();
    const resolvedPath = path.resolve(runPath);
    const manifest = loadRunManifest(resolvedPath);
    const appLogger = createAppLogger(true);

    appLogger.info("Reprocessing run", { run_id: manifest.run_id, path: resolvedPath });

    const transcriptPath = path.join(resolvedPath, "transcript.md");
    const notesPath = path.join(resolvedPath, "notes.md");

    const transcript = fs.existsSync(transcriptPath)
      ? fs.readFileSync(transcriptPath, "utf-8")
      : "(no transcript available)";
    const notes = fs.existsSync(notesPath) ? fs.readFileSync(notesPath, "utf-8") : "";

    let apiKey: string;
    try {
      apiKey = await requireSecret("claude");
    } catch (err) {
      console.error(`  ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    updateRunStatus(resolvedPath, "processing");

    const { ClaudeProvider, runPipeline } = await import("@meeting-notes/engine");
    const claude = new ClaudeProvider(apiKey, config.claude.model);
    const logger = createRunLogger(path.join(resolvedPath, "run.log"), true);

    const onlyIds = opts.only ? opts.only.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
    const maxAttempts = parseInt(opts.maxAttempts, 10) || 3;

    console.log("  Running LLM pipeline...");
    const results = await runPipeline(
      config,
      resolvedPath,
      {
        transcript,
        manualNotes: notes,
        title: manifest.title,
        date: manifest.date,
        meExcerpts: "",
        othersExcerpts: "",
      },
      (sys, usr) => claude.call(sys, usr),
      logger,
      {
        onlyIds,
        onlyFailed: opts.failed,
        skipComplete: opts.skipComplete,
        maxAttempts,
        autoOnly: !opts.all,
      }
    );

    const succeeded = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    updateRunStatus(resolvedPath, failed.length === 0 ? "complete" : "error", {
      ended: new Date().toISOString(),
    });

    console.log(`\n  Reprocess: ${succeeded.length} succeeded, ${failed.length} failed`);
    for (const r of succeeded) console.log(`    ✓ ${r.sectionId} (${r.latencyMs}ms)`);
    for (const f of failed) console.error(`    ✗ ${f.sectionId}: ${f.error}`);
    console.log();
  });

// --- logs ---
program
  .command("logs [run-path]")
  .description("Show processing logs (app-level or per-run)")
  .option("-n, --lines <n>", "Number of lines to show", "50")
  .option("-f, --follow", "Follow log output (tail -f)")
  .action(async (runPath: string | undefined, opts: { lines: string; follow: boolean }) => {
    const lines = parseInt(opts.lines, 10);

    let logPath: string;
    if (runPath) {
      logPath = path.join(path.resolve(runPath), "run.log");
    } else {
      logPath = getAppLogPath();
    }

    if (!fs.existsSync(logPath)) {
      console.log(`No log file found at: ${logPath}`);
      return;
    }

    const content = fs.readFileSync(logPath, "utf-8");
    const allLines = content.trim().split("\n");
    const tail = allLines.slice(-lines);
    console.log(tail.join("\n"));

    if (opts.follow) {
      console.log("--- following ---");
      let lastSize = fs.statSync(logPath).size;
      setInterval(() => {
        const stat = fs.statSync(logPath);
        if (stat.size > lastSize) {
          const fd = fs.openSync(logPath, "r");
          const buf = Buffer.alloc(stat.size - lastSize);
          fs.readSync(fd, buf, 0, buf.length, lastSize);
          fs.closeSync(fd);
          process.stdout.write(buf.toString("utf-8"));
          lastSize = stat.size;
        }
      }, 500);
    }
  });

// --- prompts ---
const prompts = program
  .command("prompts")
  .description("Manage meeting prompts (list, configure, run, reset)");

prompts
  .command("list")
  .description("List all prompts in the vault with their status")
  .action(() => {
    const config = loadConfig();
    const all = loadAllPrompts(config);
    if (all.length === 0) {
      console.log(`  No prompts found in ${getPromptsDir()}`);
      return;
    }
    const rows = all.map((p) => ({
      id: p.id,
      label: p.label,
      enabled: p.enabled ? "yes" : "no",
      auto: p.auto ? "auto" : "manual",
      builtin: p.builtin ? "builtin" : "",
      file: path.basename(p.sourcePath),
    }));
    const widths = {
      id: Math.max(2, ...rows.map((r) => r.id.length)),
      label: Math.max(5, ...rows.map((r) => r.label.length)),
      enabled: 7,
      auto: 6,
      builtin: 7,
    };
    const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));
    console.log(
      `  ${pad("ID", widths.id)}  ${pad("LABEL", widths.label)}  ${pad("ENABLED", widths.enabled)}  ${pad("TRIGGER", widths.auto)}  ${pad("BUILTIN", widths.builtin)}  FILE`
    );
    for (const r of rows) {
      console.log(
        `  ${pad(r.id, widths.id)}  ${pad(r.label, widths.label)}  ${pad(r.enabled, widths.enabled)}  ${pad(r.auto, widths.auto)}  ${pad(r.builtin, widths.builtin)}  ${r.file}`
      );
    }
    console.log(`\n  Directory: ${getPromptsDir()}`);
  });

prompts
  .command("path [id]")
  .description("Print the absolute path to a prompt file (or the prompts directory)")
  .action((id?: string) => {
    const config = loadConfig();
    const dir = getPromptsDir();
    if (!id) {
      console.log(dir);
      return;
    }
    const all = loadAllPrompts(config);
    const found = all.find((p) => p.id === id);
    if (!found) {
      console.error(`  Prompt "${id}" not found.`);
      process.exit(1);
    }
    console.log(found.sourcePath);
  });

prompts
  .command("new <id>")
  .description("Create a new prompt file from a minimal template")
  .option("-l, --label <label>", "Display label for the prompt")
  .option("--auto", "Set the new prompt to auto-run on every meeting (default: manual)")
  .option("-f, --filename <filename>", "Output filename to write in each run folder")
  .action((id: string, opts: { label?: string; auto?: boolean; filename?: string }) => {
    const config = loadConfig();
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) {
      console.error(`  Invalid id "${id}". Use lowercase letters, digits, hyphen, underscore.`);
      process.exit(1);
    }
    const dir = getPromptsDir();
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `${id}.md`);
    if (fs.existsSync(dest)) {
      console.error(`  File already exists: ${dest}`);
      process.exit(1);
    }
    const label = opts.label ?? id;
    const filename = opts.filename ?? `${id}.md`;
    const body = `Describe what this prompt should produce.

You have access to the transcript and any manual notes from the meeting.
Available variables: {{title}}, {{date}}, {{transcript}}, {{notes}}, {{me_excerpts}}, {{others_excerpts}}.
`;
    const frontmatter = {
      id,
      label,
      filename,
      enabled: true,
      auto: opts.auto === true,
    };
    fs.writeFileSync(dest, matter.stringify(`\n${body}`, frontmatter), "utf-8");
    console.log(`  Created: ${dest}`);
    console.log(`  Edit the body to define your prompt, then run "meeting-notes prompts list" to verify.`);
  });

prompts
  .command("enable <id>")
  .description("Mark a prompt as enabled")
  .action((id: string) => {
    const config = loadConfig();
    const updated = updatePromptFrontmatter(config, id, { enabled: true });
    if (!updated) {
      console.error(`  Prompt "${id}" not found.`);
      process.exit(1);
    }
    console.log(`  Enabled: ${id}`);
  });

prompts
  .command("disable <id>")
  .description("Mark a prompt as disabled (won't run automatically or manually)")
  .action((id: string) => {
    const config = loadConfig();
    const all = loadAllPrompts(config);
    const existing = all.find((p) => p.id === id);
    if (!existing) {
      console.error(`  Prompt "${id}" not found.`);
      process.exit(1);
    }
    if (existing.builtin) {
      console.error(`  Cannot disable builtin prompt "${id}".`);
      process.exit(1);
    }
    updatePromptFrontmatter(config, id, { enabled: false });
    console.log(`  Disabled: ${id}`);
  });

prompts
  .command("auto <id>")
  .description("Set a prompt to run automatically on every meeting processing")
  .action((id: string) => {
    const config = loadConfig();
    const updated = updatePromptFrontmatter(config, id, { auto: true });
    if (!updated) {
      console.error(`  Prompt "${id}" not found.`);
      process.exit(1);
    }
    console.log(`  Auto: ${id} will now run on every processed meeting`);
  });

prompts
  .command("manual <id>")
  .description("Set a prompt to only run when explicitly requested via 'prompts run'")
  .action((id: string) => {
    const config = loadConfig();
    const all = loadAllPrompts(config);
    const existing = all.find((p) => p.id === id);
    if (!existing) {
      console.error(`  Prompt "${id}" not found.`);
      process.exit(1);
    }
    if (existing.builtin) {
      console.error(`  Cannot set builtin prompt "${id}" to manual.`);
      process.exit(1);
    }
    updatePromptFrontmatter(config, id, { auto: false });
    console.log(`  Manual: ${id} will only run on "prompts run ${id} <run>"`);
  });

prompts
  .command("run <id> <run-path>")
  .description("Manually run a single prompt against an existing meeting run")
  .option("--max-attempts <n>", "Max retry attempts", "3")
  .action(async (id: string, runPath: string, opts: { maxAttempts: string }) => {
    const config = loadConfig();
    const resolvedPath = path.resolve(runPath);
    if (!fs.existsSync(resolvedPath)) {
      console.error(`  Run folder not found: ${resolvedPath}`);
      process.exit(1);
    }

    const all = loadAllPrompts(config);
    const target = all.find((p) => p.id === id);
    if (!target) {
      console.error(`  Prompt "${id}" not found.`);
      process.exit(1);
    }
    if (!target.enabled) {
      console.error(`  Prompt "${id}" is disabled. Run "meeting-notes prompts enable ${id}" first.`);
      process.exit(1);
    }

    const manifest = loadRunManifest(resolvedPath);
    const appLogger = createAppLogger(true);
    appLogger.info("Manually running prompt", { id, run_id: manifest.run_id });

    const transcriptPath = path.join(resolvedPath, "transcript.md");
    const notesPath = path.join(resolvedPath, "notes.md");
    const transcript = fs.existsSync(transcriptPath)
      ? fs.readFileSync(transcriptPath, "utf-8")
      : "(no transcript available)";
    const notes = fs.existsSync(notesPath) ? fs.readFileSync(notesPath, "utf-8") : "";

    let apiKey: string;
    try {
      apiKey = await requireSecret("claude");
    } catch (err) {
      console.error(`  ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    const { ClaudeProvider, runPipeline } = await import("@meeting-notes/engine");
    const claude = new ClaudeProvider(apiKey, config.claude.model);
    const logger = createRunLogger(path.join(resolvedPath, "run.log"), true);

    console.log(`  Running ${id}...`);
    const results = await runPipeline(
      config,
      resolvedPath,
      {
        transcript,
        manualNotes: notes,
        title: manifest.title,
        date: manifest.date,
        meExcerpts: "",
        othersExcerpts: "",
      },
      (sys, usr) => claude.call(sys, usr),
      logger,
      {
        onlyIds: [id],
        maxAttempts: parseInt(opts.maxAttempts, 10) || 3,
      }
    );

    for (const r of results) {
      if (r.success) {
        console.log(`    ✓ ${r.sectionId} (${r.latencyMs}ms) → ${r.filename}`);
      } else {
        console.error(`    ✗ ${r.sectionId}: ${r.error}`);
      }
    }
    console.log();
  });

prompts
  .command("reset [id]")
  .description("Overwrite a prompt (or all builtin prompts) from the shipped defaults")
  .option("-y, --yes", "Skip confirmation")
  .action(async (id: string | undefined, opts: { yes?: boolean }) => {
    const config = loadConfig();
    const dir = getPromptsDir();
    const fileName = id ? `${id}.md` : undefined;
    const defaultSrc = fileName ? path.join(DEFAULT_PROMPTS_DIR, fileName) : DEFAULT_PROMPTS_DIR;
    if (fileName && !fs.existsSync(defaultSrc)) {
      console.error(`  No default prompt named "${id}" is shipped with this package.`);
      process.exit(1);
    }

    if (!opts.yes) {
      const prompter = createPrompter();
      try {
        const what = id ? `"${id}"` : "all builtin prompts";
        const answer = (await prompter.ask(`  Overwrite ${what} from defaults? (y/N)`, "N")).toLowerCase();
        if (answer !== "y" && answer !== "yes") {
          console.log("  Cancelled.");
          return;
        }
      } finally {
        prompter.close();
      }
    }

    const written = resetDefaultPrompts(dir, fileName);
    if (written.length === 0) {
      console.log("  Nothing to reset.");
      return;
    }
    for (const p of written) console.log(`  ✓ ${path.basename(p)}`);
  });

// --- config ---
const configCmd = program
  .command("config")
  .description("View or edit app configuration (data path, Obsidian integration, etc.)");

configCmd
  .command("get")
  .description("Print the current config as YAML")
  .action(() => {
    const config = loadConfig();
    console.log(JSON.stringify(config, null, 2));
  });

configCmd
  .command("set-data-path <path>")
  .description("Move the data directory to a new location (moves files, updates config)")
  .action(async (newPath: string) => {
    const config = loadConfig();
    try {
      const { result } = moveDataDirectory(config, newPath);
      if (result.moved) {
        console.log(`  Moved data directory: ${result.from} → ${result.to}`);
      } else if (result.from === result.to) {
        console.log(`  Data directory unchanged: ${result.to}`);
      } else {
        console.log(`  Created new data directory: ${result.to}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ${msg}`);
      process.exit(1);
    }
  });

const obsidianCmd = configCmd
  .command("obsidian")
  .description("Toggle or configure the optional Obsidian viewer layer");

obsidianCmd
  .command("enable")
  .description("Enable Obsidian integration (opens notes in Obsidian on record)")
  .action(() => {
    const config = loadConfig();
    config.obsidian_integration = {
      ...config.obsidian_integration,
      enabled: true,
    };
    if (!config.obsidian_integration.vault_path) {
      console.warn(
        "  Warning: no vault_path set. Run 'meeting-notes config obsidian set-vault <path>' next."
      );
    }
    saveConfig(config);
    console.log("  Obsidian integration enabled.");
  });

obsidianCmd
  .command("disable")
  .description("Disable Obsidian integration (notes stay in the app only)")
  .action(() => {
    const config = loadConfig();
    config.obsidian_integration = {
      ...config.obsidian_integration,
      enabled: false,
    };
    saveConfig(config);
    console.log("  Obsidian integration disabled.");
  });

obsidianCmd
  .command("set-vault <vaultPath>")
  .description("Point Obsidian integration at a specific vault root")
  .action((vaultPath: string) => {
    const config = loadConfig();
    const resolved = vaultPath.replace(/^~/, os.homedir());
    config.obsidian_integration = {
      ...config.obsidian_integration,
      vault_path: resolved,
      vault_name: path.basename(resolved),
    };
    saveConfig(config);
    console.log(`  Obsidian vault set to: ${resolved}`);
    console.log(`  Vault name: ${config.obsidian_integration.vault_name}`);
  });

program.parse();
