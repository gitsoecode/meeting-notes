import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { BrowserWindow, ipcMain, dialog, shell } from "electron";
import matter from "gray-matter";
import {
  loadConfig,
  saveConfig,
  getConfigDir,
  getAppLogPath,
  resolveRunsPath,
  initProject as engineInitProject,
  moveDataDirectory,
  loadRunManifest,
  runPipeline,
  loadAllPrompts,
  updatePromptFrontmatter,
  resetDefaultPrompts,
  getPromptsDir,
  DEFAULT_PROMPTS_DIR,
  FfmpegRecorder,
  ClaudeProvider,
  OllamaProvider,
  classifyModel,
  openInObsidian,
  createRunLogger,
  createAppLogger,
  setupAsr,
  setupLlm,
  checkOllama,
  listOllamaModels,
  deleteOllamaModel,
  processRun,
  getSecret,
  setSecret,
  hasSecret,
  type AppConfig,
  type LlmProvider,
  type PipelineProgressEvent,
  type RunManifest,
} from "@meeting-notes/engine";
import { ensureOllamaDaemon, getOllamaState } from "./ollama-daemon.js";
import { detectHardware } from "./system.js";
import type {
  AppConfigDTO,
  InitConfigRequest,
  RecordingStatus,
  RunSummary,
  RunDetail,
  ReprocessRequest,
  BulkReprocessRequest,
  PromptRow,
  StartRecordingRequest,
  PipelineProgressEvent as AppPipelineProgressEvent,
  DepsCheckResult,
  DepsInstallResult,
  DepsInstallTarget,
  DetectedVault,
} from "../shared/ipc.js";
import {
  getStatus as getRecordingStatus,
  startRecording,
  stopRecording,
  stopActiveRecording as stopActive,
} from "./recording.js";

export { stopActive as stopActiveRecording };

const execFileAsync = promisify(execFile);

// ---- Helpers ----

function configToDto(config: AppConfig): AppConfigDTO {
  return {
    data_path: config.data_path,
    obsidian_integration: {
      enabled: config.obsidian_integration.enabled,
      vault_name: config.obsidian_integration.vault_name,
      vault_path: config.obsidian_integration.vault_path,
    },
    asr_provider: config.asr_provider,
    llm_provider: config.llm_provider,
    whisper_local: config.whisper_local,
    parakeet_mlx: config.parakeet_mlx,
    claude: config.claude,
    ollama: config.ollama,
    recording: config.recording,
    shortcuts: config.shortcuts,
  };
}

function dtoToConfig(dto: AppConfigDTO): AppConfig {
  return {
    data_path: dto.data_path,
    obsidian_integration: {
      enabled: dto.obsidian_integration.enabled,
      vault_name: dto.obsidian_integration.vault_name,
      vault_path: dto.obsidian_integration.vault_path,
    },
    asr_provider: dto.asr_provider,
    llm_provider: dto.llm_provider,
    whisper_local: dto.whisper_local,
    parakeet_mlx: dto.parakeet_mlx,
    claude: dto.claude,
    ollama: dto.ollama,
    recording: dto.recording,
    shortcuts: dto.shortcuts,
  };
}

function safeLoadConfig(): AppConfig | null {
  try {
    return loadConfig();
  } catch {
    return null;
  }
}

function toRunSummary(manifest: RunManifest, folderPath: string): RunSummary {
  return {
    run_id: manifest.run_id,
    title: manifest.title,
    description: manifest.description ?? null,
    date: manifest.date,
    started: manifest.started,
    ended: manifest.ended,
    status: manifest.status,
    source_mode: manifest.source_mode,
    duration_minutes: manifest.duration_minutes,
    tags: manifest.tags,
    folder_path: folderPath,
    section_ids: Object.keys(manifest.sections),
  };
}

function walkRunFolders(runsRoot: string): string[] {
  if (!fs.existsSync(runsRoot)) return [];
  const folders: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      const indexMd = path.join(full, "index.md");
      if (fs.existsSync(indexMd)) {
        folders.push(full);
      } else {
        walk(full);
      }
    }
  };
  walk(runsRoot);
  return folders;
}

// ---- Event broadcast ----

function broadcastToAll(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

export function broadcastRecordingStatus(): void {
  void getRecordingStatus().then((status) => {
    broadcastToAll("recording:status", status);
  });
}

function forwardProgress(runFolder: string, event: PipelineProgressEvent): void {
  const translated: AppPipelineProgressEvent = {
    ...event,
    runFolder,
  } as AppPipelineProgressEvent;
  broadcastToAll("pipeline:progress", translated);
}

// ---- Handler registration ----

export function registerIpcHandlers(): void {
  // ---- config ----
  ipcMain.handle("config:get", async (): Promise<AppConfigDTO | null> => {
    const config = safeLoadConfig();
    return config ? configToDto(config) : null;
  });

  ipcMain.handle("config:save", async (_e, dto: AppConfigDTO) => {
    saveConfig(dtoToConfig(dto));
  });

  ipcMain.handle("config:init", async (_e, req: InitConfigRequest) => {
    // The wizard no longer asks about audio devices — fill in sensible
    // defaults here so the user can always record, and let them tweak in
    // Settings if needed. Mic = first AVFoundation input; system = first
    // device whose name contains "blackhole" (the only loopback path on
    // macOS). If BlackHole isn't installed yet, system_device stays empty
    // and FfmpegRecorder gracefully degrades to mic-only.
    let micDevice = req.recording.mic_device;
    let systemDevice = req.recording.system_device;
    if (!micDevice || !systemDevice) {
      try {
        const recorder = new FfmpegRecorder();
        const devices = await recorder.listAudioDevices();
        if (!micDevice) micDevice = devices[0] ?? "";
        if (!systemDevice) {
          systemDevice = devices.find((d) => /blackhole/i.test(d)) ?? "";
        }
      } catch {
        // ffmpeg missing — leave fields empty; deps step will flag ffmpeg.
      }
    }

    const llmProvider = req.llm_provider ?? "claude";
    const config: AppConfig = {
      data_path: req.data_path.replace(/^~/, os.homedir()),
      obsidian_integration: req.obsidian_integration,
      asr_provider: req.asr_provider,
      llm_provider: llmProvider,
      whisper_local: {
        binary_path: "whisper-cli",
        model_path: "",
      },
      parakeet_mlx: {
        binary_path: path.join(getConfigDir(), "parakeet-venv", "bin", "mlx_audio.stt.generate"),
        model: "mlx-community/parakeet-tdt-0.6b-v2",
      },
      claude: { model: "claude-sonnet-4-6" },
      ollama: {
        base_url: "http://127.0.0.1:11434",
        model: req.ollama_model ?? "qwen3.5:9b",
      },
      recording: { mic_device: micDevice, system_device: systemDevice },
      shortcuts: { toggle_recording: "CommandOrControl+Shift+M" },
    };
    if (req.claude_api_key) await setSecret("claude", req.claude_api_key);
    if (req.openai_api_key) await setSecret("openai", req.openai_api_key);
    engineInitProject(config);
  });

  ipcMain.handle("config:set-data-path", async (_e, newPath: string) => {
    const config = loadConfig();
    const { result } = moveDataDirectory(config, newPath);
    return { from: result.from, to: result.to };
  });

  ipcMain.handle("config:set-obsidian-enabled", async (_e, enabled: boolean) => {
    const config = loadConfig();
    config.obsidian_integration = {
      ...config.obsidian_integration,
      enabled,
    };
    saveConfig(config);
  });

  ipcMain.handle("config:set-obsidian-vault", async (_e, vaultPath: string) => {
    const config = loadConfig();
    const resolved = vaultPath.replace(/^~/, os.homedir());
    config.obsidian_integration = {
      ...config.obsidian_integration,
      vault_path: resolved,
      vault_name: path.basename(resolved),
    };
    saveConfig(config);
  });

  ipcMain.handle("config:open-in-finder", async (_e, p: string) => {
    shell.showItemInFolder(p);
  });

  ipcMain.handle("config:pick-directory", async (_e, opts?: { defaultPath?: string }) => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      defaultPath: opts?.defaultPath,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("config:pick-audio-file", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [
        { name: "Audio", extensions: ["wav", "mp3", "m4a", "aiff", "flac", "ogg"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // ---- recording ----
  ipcMain.handle("recording:get-status", async (): Promise<RecordingStatus> => {
    return getRecordingStatus();
  });

  ipcMain.handle("recording:start", async (_e, req: StartRecordingRequest) => {
    const result = await startRecording(req.title, req.description ?? null);
    broadcastRecordingStatus();
    return result;
  });

  ipcMain.handle("recording:stop", async () => {
    const result = await stopRecording({
      onProgress: (event) => {
        const state = getRecordingStatus();
        void state.then((s) => {
          if (s.run_folder) forwardProgress(s.run_folder, event);
        });
      },
    });
    broadcastRecordingStatus();
    return result;
  });

  ipcMain.handle("recording:list-audio-devices", async () => {
    const recorder = new FfmpegRecorder();
    const devices = await recorder.listAudioDevices();
    return devices.map((name) => ({ name }));
  });

  // ---- runs ----
  ipcMain.handle("runs:list", async (): Promise<RunSummary[]> => {
    const config = safeLoadConfig();
    if (!config) return [];
    const runsRoot = resolveRunsPath(config);
    const folders = walkRunFolders(runsRoot);
    const out: RunSummary[] = [];
    for (const folder of folders) {
      try {
        const manifest = loadRunManifest(folder);
        out.push(toRunSummary(manifest, folder));
      } catch {
        // Skip unreadable runs.
      }
    }
    out.sort((a, b) => (b.started ?? "").localeCompare(a.started ?? ""));
    return out;
  });

  ipcMain.handle("runs:get", async (_e, runFolder: string): Promise<RunDetail> => {
    const manifest = loadRunManifest(runFolder);
    const entries = fs.readdirSync(runFolder, { withFileTypes: true });
    const files: Array<{ name: string; path: string; size: number }> = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".md") && entry.name !== "run.log") continue;
      const fullPath = path.join(runFolder, entry.name);
      const stat = fs.statSync(fullPath);
      files.push({ name: entry.name, path: fullPath, size: stat.size });
    }
    return {
      ...toRunSummary(manifest, runFolder),
      manifest,
      files,
    };
  });

  ipcMain.handle("runs:read-file", async (_e, filePath: string) => {
    return fs.readFileSync(filePath, "utf-8");
  });

  ipcMain.handle("runs:write-file", async (_e, filePath: string, content: string) => {
    fs.writeFileSync(filePath, content, "utf-8");
  });

  ipcMain.handle("runs:reprocess", async (_e, req: ReprocessRequest) => {
    const config = loadConfig();
    const manifest = loadRunManifest(req.runFolder);
    const defaultModel =
      config.llm_provider === "ollama" ? config.ollama.model : config.claude.model;
    const apiKey = await getSecret("claude");
    // Only require an Anthropic key if the default provider is Claude. With
    // ollama as default, prompts can still target Claude per-frontmatter; the
    // factory below throws lazily for those, leaving local prompts working.
    if (config.llm_provider === "claude" && !apiKey) {
      throw new Error("No Anthropic API key in Keychain — set one in Settings.");
    }
    const claudeCache: Record<string, ClaudeProvider> = {};
    const ollamaCache: Record<string, OllamaProvider> = {};
    const llmFactory = (model?: string): LlmProvider => {
      const id = model && model.trim() ? model : defaultModel;
      if (classifyModel(id) === "claude") {
        if (!apiKey) {
          throw new Error(
            `Prompt requested Claude model "${id}" but no Anthropic API key is set in Settings.`
          );
        }
        return (claudeCache[id] ??= new ClaudeProvider(apiKey, id));
      }
      return (ollamaCache[id] ??= new OllamaProvider(config.ollama.base_url, id));
    };
    const logger = createRunLogger(path.join(req.runFolder, "run.log"), false);

    const transcriptPath = path.join(req.runFolder, "transcript.md");
    const notesPath = path.join(req.runFolder, "notes.md");
    const transcript = fs.existsSync(transcriptPath)
      ? matter(fs.readFileSync(transcriptPath, "utf-8")).content
      : "";
    const notes = fs.existsSync(notesPath) ? fs.readFileSync(notesPath, "utf-8") : "";

    await runPipeline(
      config,
      req.runFolder,
      {
        transcript,
        manualNotes: notes,
        title: manifest.title,
        date: manifest.date,
        meExcerpts: "",
        othersExcerpts: "",
      },
      (sys, usr, model) => llmFactory(model).call(sys, usr, model),
      logger,
      {
        onlyIds: req.onlyIds,
        onlyFailed: req.onlyFailed,
        skipComplete: req.skipComplete,
        autoOnly: req.autoOnly,
        onProgress: (event) => forwardProgress(req.runFolder, event),
      }
    );
    broadcastToAll("pipeline:progress", {
      type: "run-complete",
      runFolder: req.runFolder,
      succeeded: [],
      failed: [],
    } satisfies AppPipelineProgressEvent);
  });

  ipcMain.handle("runs:bulk-reprocess", async (_e, req: BulkReprocessRequest) => {
    // Serial for now; each run streams its own progress events.
    for (const runFolder of req.runFolders) {
      try {
        await new Promise<void>((resolve) => {
          // Reuse the single-run handler by calling its body directly.
          ipcMain.emit(
            "runs:reprocess",
            undefined as unknown as Electron.IpcMainInvokeEvent,
            { runFolder, onlyIds: req.onlyIds }
          );
          resolve();
        });
      } catch (err) {
        broadcastToAll("pipeline:progress", {
          type: "run-failed",
          runFolder,
          error: err instanceof Error ? err.message : String(err),
        } satisfies AppPipelineProgressEvent);
      }
    }
  });

  ipcMain.handle(
    "runs:process-audio",
    async (_e, audioPath: string, title: string) => {
      const config = loadConfig();
      const { createRun } = await import("@meeting-notes/engine");
      const runContext = createRun(config, title, { sourceMode: "file", quiet: true });
      const audioDir = path.join(runContext.folderPath, "audio");
      fs.mkdirSync(audioDir, { recursive: true });
      const destAudio = path.join(audioDir, path.basename(audioPath));
      fs.copyFileSync(audioPath, destAudio);

      void (async () => {
        try {
          await processRun({
            config,
            runFolder: runContext.folderPath,
            title,
            date: runContext.manifest.date,
            audioFiles: [{ path: destAudio, speaker: "unknown" }],
            logger: runContext.logger,
            onProgress: (event) => forwardProgress(runContext.folderPath, event),
          });
        } catch (err) {
          broadcastToAll("pipeline:progress", {
            type: "run-failed",
            runFolder: runContext.folderPath,
            error: err instanceof Error ? err.message : String(err),
          } satisfies AppPipelineProgressEvent);
        }
      })();

      return { run_folder: runContext.folderPath };
    }
  );

  ipcMain.handle("runs:open-in-obsidian", async (_e, filePath: string) => {
    const config = loadConfig();
    await openInObsidian(config, filePath);
  });

  ipcMain.handle("runs:open-in-finder", async (_e, runFolder: string) => {
    shell.showItemInFolder(path.join(runFolder, "index.md"));
  });

  ipcMain.handle("runs:delete", async (_e, runFolder: string) => {
    fs.rmSync(runFolder, { recursive: true, force: true });
  });

  ipcMain.handle(
    "runs:update-meta",
    async (
      _e,
      req: { runFolder: string; title?: string; description?: string | null }
    ) => {
      const { updateRunStatus } = await import("@meeting-notes/engine");
      const manifest = loadRunManifest(req.runFolder);
      const updates: Partial<RunManifest> = {};
      if (typeof req.title === "string" && req.title.trim()) {
        updates.title = req.title.trim();
      }
      if ("description" in req) {
        updates.description = req.description && req.description.trim() ? req.description.trim() : null;
      }
      // Re-write the manifest while preserving status.
      updateRunStatus(req.runFolder, manifest.status, updates);
    }
  );

  // ---- prompts ----
  ipcMain.handle("prompts:list", async (): Promise<PromptRow[]> => {
    const config = safeLoadConfig();
    const all = loadAllPrompts(config ?? undefined);
    return all.map((p) => ({
      id: p.id,
      label: p.label,
      filename: p.filename,
      enabled: p.enabled,
      auto: p.auto,
      builtin: p.builtin,
      model: p.model,
      source_path: p.sourcePath,
      body: p.prompt,
    }));
  });

  ipcMain.handle(
    "prompts:save",
    async (_e, id: string, body: string, patch: Partial<PromptRow>) => {
      const config = safeLoadConfig();
      const all = loadAllPrompts(config ?? undefined);
      const existing = all.find((p) => p.id === id);
      if (!existing) throw new Error(`Prompt not found: ${id}`);
      // Merge body first.
      const raw = fs.readFileSync(existing.sourcePath, "utf-8");
      const parsed = matter(raw);
      const mergedFrontmatter: Record<string, unknown> = {
        ...parsed.data,
        ...("label" in patch ? { label: patch.label } : {}),
        ...("filename" in patch ? { filename: patch.filename } : {}),
        ...("enabled" in patch ? { enabled: patch.enabled } : {}),
        ...("auto" in patch ? { auto: patch.auto } : {}),
      };
      if ("model" in patch) {
        // Empty string / null means "fall back to the default in Settings",
        // which we represent on disk by deleting the key entirely so the
        // frontmatter stays clean.
        if (patch.model && String(patch.model).trim()) {
          mergedFrontmatter.model = String(patch.model).trim();
        } else {
          delete mergedFrontmatter.model;
        }
      }
      const rewritten = matter.stringify(`\n${body.trim()}\n`, mergedFrontmatter);
      fs.writeFileSync(existing.sourcePath, rewritten, "utf-8");
    }
  );

  ipcMain.handle(
    "prompts:create",
    async (_e, id: string, label: string, filename: string, body: string) => {
      const dir = getPromptsDir();
      fs.mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, `${id}.md`);
      if (fs.existsSync(dest)) {
        throw new Error(`Prompt "${id}" already exists.`);
      }
      const frontmatter = { id, label, filename, enabled: true, auto: false };
      fs.writeFileSync(
        dest,
        matter.stringify(`\n${body.trim() || "Describe what this prompt should produce."}\n`, frontmatter),
        "utf-8"
      );
    }
  );

  ipcMain.handle("prompts:enable", async (_e, id: string, enabled: boolean) => {
    const config = safeLoadConfig();
    updatePromptFrontmatter(config ?? undefined, id, { enabled });
  });

  ipcMain.handle("prompts:set-auto", async (_e, id: string, auto: boolean) => {
    const config = safeLoadConfig();
    updatePromptFrontmatter(config ?? undefined, id, { auto });
  });

  ipcMain.handle("prompts:reset-to-default", async (_e, id?: string) => {
    const dir = getPromptsDir();
    const fileName = id ? `${id}.md` : undefined;
    if (fileName) {
      const src = path.join(DEFAULT_PROMPTS_DIR, fileName);
      if (!fs.existsSync(src)) throw new Error(`No builtin named "${id}".`);
    }
    resetDefaultPrompts(dir, fileName);
  });

  ipcMain.handle("prompts:get-dir", async () => getPromptsDir());

  ipcMain.handle("prompts:open-in-finder", async () => {
    shell.showItemInFolder(getPromptsDir());
  });

  // ---- secrets ----
  ipcMain.handle("secrets:has", async (_e, name: "claude" | "openai") => {
    return hasSecret(name);
  });

  ipcMain.handle("secrets:set", async (_e, name: "claude" | "openai", value: string) => {
    await setSecret(name, value);
  });

  // ---- setup-asr ----
  ipcMain.handle("setup-asr", async (_e, opts: { force?: boolean }) => {
    await setupAsr({
      force: opts.force,
      onLog: (line) => broadcastToAll("setup-asr:log", line),
    });
  });

  // ---- dep install (brew wrapper) ----
  //
  // The Parakeet installer already streams logs via setup-asr:log. This
  // mirrors that pattern for ffmpeg + BlackHole via Homebrew so the wizard
  // can offer one-click installs without ever dropping the user into a
  // terminal. We deliberately don't try to install Homebrew itself — that
  // requires interactive sudo and an internet redirect dance that's
  // much safer to hand off to the user.
  ipcMain.handle("deps:check-brew", async (): Promise<boolean> => {
    const brew = await whichCmd("brew");
    return brew !== null;
  });

  ipcMain.handle(
    "deps:install",
    async (_e, target: DepsInstallTarget): Promise<DepsInstallResult> => {
      const brew = await whichCmd("brew");
      if (!brew) {
        return { ok: false, brewMissing: true };
      }

      const args =
        target === "ffmpeg"
          ? ["install", "ffmpeg"]
          : ["install", "--cask", "blackhole-2ch"];

      broadcastToAll("deps-install:log", `$ brew ${args.join(" ")}`);

      return await new Promise<DepsInstallResult>((resolve) => {
        const child = spawn(brew, args, {
          env: { ...process.env },
          stdio: ["ignore", "pipe", "pipe"],
        });

        const streamLines = (chunk: Buffer) => {
          const text = chunk.toString("utf-8");
          for (const line of text.split(/\r?\n/)) {
            if (line.trim() !== "") {
              broadcastToAll("deps-install:log", line);
            }
          }
        };
        child.stdout?.on("data", streamLines);
        child.stderr?.on("data", streamLines);

        child.on("error", (err) => {
          resolve({ ok: false, error: err.message });
        });
        child.on("exit", (code) => {
          if (code === 0) {
            broadcastToAll("deps-install:log", `✓ ${target} installed`);
            resolve({ ok: true });
          } else {
            resolve({ ok: false, error: `brew exited with code ${code}` });
          }
        });
      });
    }
  );

  // ---- Restart macOS audio system ----
  //
  // Used after a fresh BlackHole install when CoreAudio hasn't picked up
  // the new HAL plugin yet. `killall coreaudiod` requires sudo, so we
  // route it through `osascript ... with administrator privileges` —
  // macOS shows the standard credentials dialog, the user clicks Allow,
  // coreaudiod relaunches under launchd, and BlackHole becomes
  // enumerable in AVFoundation within ~1 second.
  ipcMain.handle(
    "deps:restart-audio",
    async (): Promise<{ ok: boolean; error?: string }> => {
      try {
        await execFileAsync("osascript", [
          "-e",
          'do shell script "killall coreaudiod" with administrator privileges',
        ]);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  );

  // ---- Obsidian vault detection ----
  //
  // Quick-pick helper for step 1 of the wizard: scan the usual suspects
  // (~/Obsidian/*, ~/Documents/*) one level deep for directories that
  // contain a `.obsidian/` subfolder (Obsidian's marker file). Cheap
  // enough to run on every wizard mount — we stat at most a few dozen
  // dirs.
  ipcMain.handle("obsidian:detect-vaults", async (): Promise<DetectedVault[]> => {
    const home = os.homedir();
    const scanRoots = [
      path.join(home, "Obsidian"),
      path.join(home, "Documents"),
    ];
    const found: DetectedVault[] = [];
    const seen = new Set<string>();
    for (const root of scanRoots) {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(root, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const vaultPath = path.join(root, entry.name);
        if (seen.has(vaultPath)) continue;
        const marker = path.join(vaultPath, ".obsidian");
        try {
          const st = fs.statSync(marker);
          if (st.isDirectory()) {
            found.push({ path: vaultPath, name: entry.name });
            seen.add(vaultPath);
          }
        } catch {
          // not a vault
        }
      }
    }
    return found;
  });

  // ---- logs ----
  ipcMain.handle("logs:tail-app", async (_e, lines: number) => {
    return tailFile(getAppLogPath(), lines);
  });

  ipcMain.handle("logs:tail-run", async (_e, runFolder: string, lines: number) => {
    return tailFile(path.join(runFolder, "run.log"), lines);
  });

  ipcMain.handle("logs:app-path", async () => getAppLogPath());

  // ---- deps check ----
  ipcMain.handle("deps:check", async (): Promise<DepsCheckResult> => {
    const ffmpeg = await whichCmd("ffmpeg");
    const python = (await whichCmd("python3.12")) ?? (await whichCmd("python3.11")) ?? (await whichCmd("python3"));
    // BlackHole detection is two-step. First, is the HAL driver file on
    // disk? brew puts it at /Library/Audio/Plug-Ins/HAL/BlackHole2ch.driver.
    // Second, has CoreAudio actually loaded it? We answer that by asking
    // ffmpeg/AVFoundation to enumerate audio devices. The two can disagree:
    // immediately after a fresh `brew install --cask blackhole-2ch`, the
    // driver bundle is on disk but coreaudiod hasn't picked it up yet.
    // Reporting "installed-not-loaded" lets the wizard offer a Restart
    // Audio recovery instead of pointlessly telling the user to install
    // something that's already there.
    const blackholeDriverPath = "/Library/Audio/Plug-Ins/HAL/BlackHole2ch.driver";
    let driverPresent = false;
    try {
      driverPresent = fs.statSync(blackholeDriverPath).isDirectory();
    } catch {
      driverPresent = false;
    }
    let avfoundationLoaded = false;
    try {
      const recorder = new FfmpegRecorder();
      const devices = await recorder.listAudioDevices();
      avfoundationLoaded = devices.some((d) => d.toLowerCase().includes("blackhole"));
    } catch {
      avfoundationLoaded = false;
    }
    const blackhole: DepsCheckResult["blackhole"] = avfoundationLoaded
      ? "loaded"
      : driverPresent
        ? "installed-not-loaded"
        : "missing";
    // Parakeet: check the default install path rather than the configured path,
    // because during the Setup Wizard the user hasn't written a config yet and
    // safeLoadConfig() returns null. This default matches DEFAULT_CONFIG in
    // engine/core/config.ts — if either changes, this check needs to move.
    const parakeetBin = path.join(
      os.homedir(),
      ".meeting-notes",
      "parakeet-venv",
      "bin",
      "mlx_audio.stt.generate"
    );
    let parakeet: string | null = null;
    try {
      const st = fs.statSync(parakeetBin);
      // Executable bit check — if the file is there but not executable the
      // venv is broken and we should offer to reinstall.
      if (st.isFile() && (st.mode & 0o111) !== 0) {
        parakeet = parakeetBin;
      }
    } catch {
      parakeet = null;
    }
    // Ollama: ask the daemon module what state it's in (or attempt to ping a
    // pre-existing system daemon if we haven't started ours yet). We don't
    // spawn from inside deps:check — that's app-startup's job — so a fully
    // cloud-only user never pays the cost.
    let ollamaDaemonUp = false;
    let ollamaSource: DepsCheckResult["ollama"]["source"] | undefined;
    let installedModels: string[] = [];
    try {
      const state = getOllamaState();
      if (state) {
        ollamaSource = state.source;
        const status = await checkOllama(state.baseUrl);
        ollamaDaemonUp = status.daemon;
        installedModels = status.installedModels;
      } else {
        const status = await checkOllama();
        ollamaDaemonUp = status.daemon;
        installedModels = status.installedModels;
        if (ollamaDaemonUp) ollamaSource = "system-running";
      }
    } catch {
      ollamaDaemonUp = false;
    }
    return {
      ffmpeg,
      python,
      blackhole,
      parakeet,
      ollama: {
        daemon: ollamaDaemonUp,
        source: ollamaSource,
        installedModels,
      },
    };
  });

  // ---- llm (Ollama) ----
  ipcMain.handle("llm:check", async (): Promise<DepsCheckResult["ollama"]> => {
    try {
      // Spinning up the daemon here means the wizard's "check" call is also
      // what brings Ollama online for the first time — saves a separate
      // "start daemon" UI step.
      const state = await ensureOllamaDaemon();
      const status = await checkOllama(state.baseUrl);
      return {
        daemon: status.daemon,
        source: state.source,
        installedModels: status.installedModels,
      };
    } catch {
      return { daemon: false, installedModels: [] };
    }
  });

  ipcMain.handle(
    "llm:setup",
    async (_e, opts: { model: string; force?: boolean }) => {
      // Make sure the daemon is up first; setupLlm pings but won't spawn.
      const state = await ensureOllamaDaemon();
      await setupLlm({
        model: opts.model,
        baseUrl: state.baseUrl,
        force: opts.force,
        onLog: (line) => broadcastToAll("setup-llm:log", line),
      });
    }
  );

  ipcMain.handle("llm:list-installed", async (): Promise<string[]> => {
    try {
      const state = getOllamaState();
      const baseUrl = state?.baseUrl;
      const tags = await listOllamaModels(baseUrl);
      return tags.map((t) => t.name);
    } catch {
      return [];
    }
  });

  ipcMain.handle("llm:remove", async (_e, model: string) => {
    const state = getOllamaState();
    await deleteOllamaModel(model, state?.baseUrl);
  });

  // ---- system ----
  ipcMain.handle("system:detect-hardware", async () => {
    return detectHardware();
  });

  // Create an app logger on first registration — gives us structured
  // startup logs in ~/.meeting-notes/app.log.
  try {
    createAppLogger(false).info("Electron IPC handlers registered");
  } catch {
    // No config dir yet — harmless.
  }
}

function tailFile(filePath: string, lines: number): string {
  if (!fs.existsSync(filePath)) return "";
  const content = fs.readFileSync(filePath, "utf-8");
  const all = content.split(/\r?\n/);
  return all.slice(Math.max(0, all.length - lines)).join("\n");
}

async function whichCmd(cmd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("/usr/bin/env", ["which", cmd]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
