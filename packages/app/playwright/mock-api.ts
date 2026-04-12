import type { Page } from "@playwright/test";

export async function installMockApi(page: Page) {
  await page.addInitScript(() => {
    const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
    const listeners = {
      recordingStatus: new Set(),
      pipelineProgress: new Set(),
      setupAsrLog: new Set(),
      setupLlmLog: new Set(),
      setupLlmProgress: new Set(),
      depsInstallLog: new Set(),
      appAction: new Set(),
      jobUpdate: new Set(),
      logEntry: new Set(),
      processUpdate: new Set(),
    };
    const stateStorageKey = "__meeting_notes_mock_state__";
    const promptsStorageKey = "__meeting_notes_prompts__";

    const config = {
      data_path: "/Users/test/Meeting Notes",
      obsidian_integration: {
        enabled: false,
      },
      asr_provider: "parakeet-mlx",
      llm_provider: "ollama",
      whisper_local: {
        binary_path: "whisper-cli",
        model_path: "",
      },
      parakeet_mlx: {
        binary_path: "/Users/test/.meeting-notes/parakeet",
        model: "mlx-community/parakeet-tdt-0.6b-v2",
      },
      claude: {
        model: "claude-sonnet-4-6",
      },
      ollama: {
        base_url: "http://127.0.0.1:11434",
        model: "qwen3.5:9b",
      },
      recording: {
        mic_device: "Built-in Mic",
        system_device: "BlackHole 2ch",
      },
      shortcuts: {
        toggle_recording: "CommandOrControl+Shift+M",
      },
    };

    let hasClaude = true;
    let hasOpenai = false;
    let recording = {
      active: false,
    };
    let nextRunCounter = 3;
    let nextJobCounter = 2;
    const installedLocalModels = ["qwen3.5:9b"];
    const jobs = [
      {
        id: "job-1",
        kind: "process-import",
        status: "running",
        title: "Customer call",
        subtitle: "Processing imported media",
        createdAt: "2026-04-08T19:00:00.000Z",
        startedAt: "2026-04-08T19:00:00.000Z",
        cancelable: true,
        runFolder: "/runs/customer-call",
        provider: "ollama",
        model: "qwen3.5:9b",
        progress: {
          completedOutputs: 0,
          failedOutputs: 0,
          totalOutputs: 1,
          currentOutputLabel: "Summary + Action Items",
        },
      },
    ];
    const appLogEntries = [
      {
        id: "log-3",
        timestamp: "2026-04-08T19:02:21.000Z",
        level: "error",
        component: "renderer",
        message: "Prompt run failed to render preview",
        detail: "TypeError: Cannot read properties of undefined",
        data: {
          stack: "TypeError: Cannot read properties of undefined\n    at PromptPreview.tsx:44:12",
          detail: "PromptPreview.tsx:44:12",
        },
      },
      {
        id: "log-2",
        timestamp: "2026-04-08T19:01:04.000Z",
        level: "warn",
        component: "jobs",
        message: "Retrying pipeline section",
        data: {
          jobId: "job-1",
          runFolder: "/runs/customer-call",
        },
      },
      {
        id: "log-1",
        timestamp: "2026-04-08T19:00:00.000Z",
        level: "info",
        component: "app",
        message: "Electron IPC handlers registered",
        data: {},
      },
    ];
    const processes = [
      {
        id: "process-ollama",
        type: "ollama-daemon",
        label: "Ollama daemon",
        status: "running",
        pid: 42111,
        command: "ollama serve",
        startedAt: "2026-04-08T18:58:00.000Z",
      },
      {
        id: "process-ffmpeg",
        type: "ffmpeg",
        label: "Microphone capture",
        status: "running",
        pid: 42112,
        command: "ffmpeg avfoundation recording",
        startedAt: "2026-04-08T19:00:00.000Z",
        runFolder: "/runs/customer-call",
      },
    ];

    const defaultPrompts = [
      {
        id: "summary",
        label: "Summary + Action Items",
        description: "Default meeting prompt for most meetings.",
        sort_order: 10,
        filename: "summary.md",
        enabled: true,
        auto: true,
        builtin: true,
        model: null,
        source_path: "/Users/test/.meeting-notes/prompts/summary.md",
        body: "Produce a concise summary and action items.",
      },
      {
        id: "one-on-one-follow-up",
        label: "1:1 Follow-up",
        description: null,
        sort_order: 20,
        filename: "one-on-one-follow-up.md",
        enabled: false,
        auto: false,
        builtin: true,
        model: null,
        source_path: "/Users/test/.meeting-notes/prompts/one-on-one-follow-up.md",
        body: "Draft a concise 1:1 follow-up with support items and next steps.",
      },
      {
        id: "decision-log",
        label: "Decision Log",
        description: "Capture decisions and open questions.",
        sort_order: 40,
        filename: "decision-log.md",
        enabled: false,
        auto: false,
        builtin: true,
        model: "qwen3.5:9b",
        source_path: "/Users/test/.meeting-notes/prompts/decision-log.md",
        body: "List the decisions made in the meeting.",
      },
      {
        id: "follow-up-brief",
        label: "Follow-up Brief",
        description: "Draft a short follow-up with next steps and owners.",
        sort_order: 50,
        filename: "follow-up-brief.md",
        enabled: true,
        auto: true,
        builtin: false,
        model: "claude-sonnet-4-6",
        source_path: "/Users/test/.meeting-notes/prompts/follow-up-brief.md",
        body: "Draft a short follow-up with next steps and owners.",
      },
    ];

    const runs = [
      {
        run_id: "run-1",
        title: "Weekly planning",
        description: "Sprint planning and next steps.",
        date: "2026-04-08",
        started: "2026-04-08T17:30:00.000Z",
        ended: "2026-04-08T18:10:00.000Z",
        status: "complete",
        source_mode: "both",
        duration_minutes: 40,
        tags: ["planning"],
        folder_path: "/runs/weekly-planning",
        prompt_output_ids: ["summary", "decision-log"],
      },
      {
        run_id: "run-2",
        title: "Customer call",
        description: "Follow-up discussion with a customer.",
        date: "2026-04-08",
        started: "2026-04-08T19:00:00.000Z",
        ended: null,
        status: "processing",
        source_mode: "file",
        duration_minutes: 32,
        tags: ["customer"],
        folder_path: "/runs/customer-call",
        prompt_output_ids: ["summary"],
      },
    ];

    const manifests = {
      "/runs/weekly-planning": {
        description: "Sprint planning and next steps.",
        participants: ["Jesse", "Alex"],
        tags: ["planning"],
        source_mode: "both",
        asr_provider: "parakeet-mlx",
        llm_provider: "ollama",
        prompt_outputs: {
          summary: {
            status: "complete",
            label: "Summary + Action Items",
            filename: "summary.md",
            model: "qwen3.5:9b",
          },
          "decision-log": {
            status: "complete",
            label: "Decision Log",
            filename: "decision-log.md",
            model: "qwen3.5:9b",
          },
        },
      },
      "/runs/customer-call": {
        description: "Follow-up discussion with a customer.",
        participants: ["Jesse", "Taylor"],
        tags: ["customer"],
        source_mode: "file",
        asr_provider: "parakeet-mlx",
        llm_provider: "ollama",
        prompt_outputs: {
          summary: {
            status: "running",
            label: "Summary + Action Items",
            filename: "summary.md",
            model: "qwen3.5:9b",
          },
        },
      },
    };

    const files = {
      "/runs/weekly-planning": [
        { name: "index.md", size: 200, kind: "document" },
        { name: "notes.md", size: 420, kind: "document" },
        { name: "transcript.md", size: 830, kind: "document" },
        { name: "summary.md", size: 310, kind: "document" },
        { name: "decision-log.md", size: 280, kind: "document" },
        { name: "audio/mic.wav", size: 4200000, kind: "media" },
        { name: "audio/system.wav", size: 6100000, kind: "media" },
      ],
      "/runs/customer-call": [
        { name: "index.md", size: 180, kind: "document" },
        { name: "notes.md", size: 260, kind: "document" },
        { name: "transcript.md", size: 580, kind: "document" },
        { name: "audio/customer-call.mp4", size: 15800000, kind: "media" },
      ],
    };

    const docs = {
      "/runs/weekly-planning": {
        "notes.md":
          "# Planning Notes\n\nThese are the notes I found:<br />\n\n- Review backlog\n- Confirm owners\n",
        "transcript.md":
          "---\nsource: mock\n---\n### Me\n\n`00:00` Welcome everyone.\n\n`00:15` We need to lock the sprint scope.\n\n### Others\n\n`00:32` Let's keep the reporting task in.\n",
        "summary.md":
          "---\nsource: mock\n---\n# Summary\n\n## Highlights\n\n- Locked sprint scope.\n- Confirmed follow-up owners.\n",
        "decision-log.md":
          "---\nsource: mock\n---\n# Decisions\n\n- Keep reporting task in scope.\n- Revisit onboarding in the next sprint.\n",
      },
      "/runs/customer-call": {
        "notes.md": "# Customer Call Notes\n\n- Pricing question\n",
        "transcript.md":
          "---\nsource: mock\n---\n### Others\n\n`00:00` We need clarification on pricing.\n",
      },
    };
    const prepDocs = {
      "/runs/weekly-planning": "# Prep\n\n- Review backlog\n- Confirm owners\n",
      "/runs/customer-call": "# Customer prep\n\n- Bring pricing notes\n",
    };
    const attachmentsByRun = {
      "/runs/weekly-planning": [{ name: "agenda.pdf", size: 32000 }],
      "/runs/customer-call": [],
    } as Record<string, Array<{ name: string; size: number }>>;
    const missingFolders = new Set<string>();
    const missingAttachmentDirs = new Set<string>();
    const failedPromptOutputs: Record<string, string> = {};
    const depsState = {
      ffmpeg: "/opt/homebrew/bin/ffmpeg",
      ffmpegVersion: "7.1-mock",
      blackhole: "loaded",
      python: "/usr/bin/python3",
      pythonVersion: "3.9.6",
      parakeet: "/Users/test/.meeting-notes/parakeet",
      ollamaVersion: "0.7.2",
      brewAvailable: true,
    } as {
      ffmpeg: string | null;
      ffmpegVersion: string | null;
      blackhole: "missing" | "installed-not-loaded" | "loaded";
      python: string | null;
      pythonVersion: string | null;
      parakeet: string | null;
      ollamaVersion: string | null;
      brewAvailable: boolean | null;
    };
    const externalActionLog: Array<{ type: string; payload?: unknown }> = [];

    const hydrateArray = <T,>(target: T[], source: T[]) => {
      target.splice(0, target.length, ...clone(source));
    };
    const hydrateObject = <T extends object>(target: T, source: T) => {
      Object.keys(target).forEach((key) => delete (target as Record<string, unknown>)[key]);
      Object.assign(target, clone(source));
    };
    const snapshotState = () => ({
      config: clone(config),
      hasClaude,
      hasOpenai,
      recording: clone(recording),
      nextRunCounter,
      nextJobCounter,
      installedLocalModels: clone(installedLocalModels),
      jobs: clone(jobs),
      appLogEntries: clone(appLogEntries),
      processes: clone(processes),
      runs: clone(runs),
      manifests: clone(manifests),
      files: clone(files),
      docs: clone(docs),
      prepDocs: clone(prepDocs),
      attachmentsByRun: clone(attachmentsByRun),
      missingFolders: [...missingFolders],
      missingAttachmentDirs: [...missingAttachmentDirs],
      failedPromptOutputs: clone(failedPromptOutputs),
      depsState: clone(depsState),
      externalActionLog: clone(externalActionLog),
    });
    const persistState = () => {
      try {
        window.sessionStorage.setItem(stateStorageKey, JSON.stringify(snapshotState()));
      } catch {}
    };
    const restoreState = () => {
      try {
        const saved = window.sessionStorage.getItem(stateStorageKey);
        if (!saved) return;
        const parsed = JSON.parse(saved);
        hydrateObject(config, parsed.config ?? config);
        hasClaude = parsed.hasClaude ?? hasClaude;
        hasOpenai = parsed.hasOpenai ?? hasOpenai;
        recording = parsed.recording ?? recording;
        nextRunCounter = parsed.nextRunCounter ?? nextRunCounter;
        nextJobCounter = parsed.nextJobCounter ?? nextJobCounter;
        hydrateArray(installedLocalModels, parsed.installedLocalModels ?? installedLocalModels);
        hydrateArray(jobs, parsed.jobs ?? jobs);
        hydrateArray(appLogEntries, parsed.appLogEntries ?? appLogEntries);
        hydrateArray(processes, parsed.processes ?? processes);
        hydrateArray(runs, parsed.runs ?? runs);
        hydrateObject(manifests, parsed.manifests ?? manifests);
        hydrateObject(files, parsed.files ?? files);
        hydrateObject(docs, parsed.docs ?? docs);
        hydrateObject(prepDocs, parsed.prepDocs ?? prepDocs);
        hydrateObject(attachmentsByRun, parsed.attachmentsByRun ?? attachmentsByRun);
        missingFolders.clear();
        (parsed.missingFolders ?? []).forEach((folder: string) => missingFolders.add(folder));
        missingAttachmentDirs.clear();
        (parsed.missingAttachmentDirs ?? []).forEach((folder: string) => missingAttachmentDirs.add(folder));
        Object.keys(failedPromptOutputs).forEach((key) => delete failedPromptOutputs[key]);
        Object.assign(failedPromptOutputs, parsed.failedPromptOutputs ?? {});
        hydrateObject(depsState, parsed.depsState ?? depsState);
        hydrateArray(externalActionLog, parsed.externalActionLog ?? externalActionLog);
      } catch {}
    };
    const pruneRun = (runFolder: string) => {
      const runIndex = runs.findIndex((run) => run.folder_path === runFolder);
      if (runIndex !== -1) runs.splice(runIndex, 1);
      delete manifests[runFolder];
      delete files[runFolder];
      delete docs[runFolder];
      delete prepDocs[runFolder];
      delete attachmentsByRun[runFolder];
      missingFolders.delete(runFolder);
      missingAttachmentDirs.delete(runFolder);
      Object.keys(failedPromptOutputs)
        .filter((key) => key.startsWith(`${runFolder}::`))
        .forEach((key) => delete failedPromptOutputs[key]);
      persistState();
    };
    const ensureRunAvailable = (runFolder: string, { prune = false }: { prune?: boolean } = {}) => {
      if (!missingFolders.has(runFolder)) return;
      if (prune) pruneRun(runFolder);
      throw new Error("This meeting no longer exists on disk.");
    };
    const persistPrompts = (promptsToPersist: unknown[]) => {
      try {
        window.sessionStorage.setItem(promptsStorageKey, JSON.stringify(promptsToPersist));
      } catch {}
    };

    const emit = (kind, payload) => {
      listeners[kind].forEach((handler) => handler(payload));
    };

    const subscribe = (kind, cb) => {
      listeners[kind].add(cb);
      return () => listeners[kind].delete(cb);
    };

    const upsertJob = (job) => {
      const index = jobs.findIndex((item) => item.id === job.id);
      if (index === -1) jobs.unshift(job);
      else jobs[index] = job;
      persistState();
      emit("jobUpdate", clone(job));
    };
    const upsertProcess = (process) => {
      const index = processes.findIndex((item) => item.id === process.id);
      if (index === -1) processes.unshift(process);
      else processes[index] = process;
      persistState();
      emit("processUpdate", clone(process));
    };
    const pushLogEntry = (entry) => {
      appLogEntries.unshift(entry);
      persistState();
      emit("logEntry", clone(entry));
    };
    const recordExternalAction = (type: string, payload?: unknown) => {
      externalActionLog.unshift({ type, payload });
      if (externalActionLog.length > 20) externalActionLog.length = 20;
      persistState();
    };

    const getRun = (runFolder) => {
      ensureRunAvailable(runFolder, { prune: true });
      const run = runs.find((item) => item.folder_path === runFolder);
      if (!run) throw new Error("Run not found");
      return {
        ...run,
        manifest: manifests[runFolder],
        files: files[runFolder] ?? [],
      };
    };

    const loadPromptState = () => {
      try {
        const saved = window.sessionStorage.getItem(promptsStorageKey);
        if (!saved) return clone(defaultPrompts);
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed : clone(defaultPrompts);
      } catch {
        return clone(defaultPrompts);
      }
    };
    const prompts = loadPromptState();
    const persistPromptState = () => {
      persistPrompts(prompts);
    };
    restoreState();

    const getPromptDefinition = (promptId) =>
      prompts.find((prompt) => prompt.id === promptId) ?? prompts[0];

    const renderPromptOutput = (prompt) => {
      switch (prompt.id) {
        case "summary":
          return "---\nsource: mock\n---\n# Summary\n\n- Clarified pricing next steps.\n";
        case "decision-log":
          return "---\nsource: mock\n---\n# Decisions\n\n- Confirm pricing update before renewal.\n";
        case "one-on-one-follow-up":
          return "---\nsource: mock\n---\n# Follow-up\n\n- Send a short recap with support items and next steps.\n";
        default:
          return `---\nsource: mock\n---\n# ${prompt.label}\n\n- Generated output for ${prompt.label}.\n`;
      }
    };

    const ensurePromptSection = (runFolder, promptId, status) => {
      const prompt = getPromptDefinition(promptId);
      manifests[runFolder] ??= {
        description: null,
        participants: [],
        tags: [],
        source_mode: "both",
        asr_provider: "parakeet-mlx",
        llm_provider: "ollama",
        prompt_outputs: {},
      };
      manifests[runFolder].prompt_outputs[prompt.id] = {
        status,
        label: prompt.label,
        filename: prompt.filename,
        model: prompt.model ?? "qwen3.5:9b",
      };
      const run = runs.find((item) => item.folder_path === runFolder);
      if (run && !run.prompt_output_ids.includes(prompt.id)) {
        run.prompt_output_ids.push(prompt.id);
      }
      return prompt;
    };

    const writePromptOutput = (runFolder, promptId) => {
      const prompt = ensurePromptSection(runFolder, promptId, "complete");
      docs[runFolder] ??= {};
      docs[runFolder][prompt.filename] = renderPromptOutput(prompt);
      files[runFolder] = [
        ...(files[runFolder] ?? []).filter((file) => file.name !== prompt.filename),
        { name: prompt.filename, size: 132, kind: "document" },
      ];
      return prompt;
    };

    const buildRunComplete = (runFolder, succeeded, failed = []) => {
      emit("pipelineProgress", {
        type: "run-complete",
        runFolder,
        succeeded,
        failed,
      });
    };

    const processRecordedRun = (req, { background }) => {
      const run = runs.find((item) => item.folder_path === req.runFolder);
      const promptIds = req.onlyIds ?? [];
      const selectedPrompts = promptIds.map((promptId) => getPromptDefinition(promptId));
      const totalOutputs = 1 + selectedPrompts.length;
      const job = {
        id: `job-${nextJobCounter++}`,
        kind: "process-recording",
        status: "running",
        title: run?.title ?? "Meeting",
        subtitle: promptIds.length > 0 ? "Processing selected meeting outputs" : "Building transcript",
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        cancelable: true,
        runFolder: req.runFolder,
        promptIds,
        provider: "ollama",
        model: "qwen3.5:9b",
        progress: {
          completedOutputs: 0,
          failedOutputs: 0,
          totalOutputs,
          currentOutputLabel: "Build transcript",
        },
      };
      upsertJob(job);

      const execute = () => {
        ensureRunAvailable(req.runFolder, { prune: true });
        if (run) {
          run.status = "processing";
          run.prompt_output_ids = promptIds;
        }
        manifests[req.runFolder] ??= {
          description: null,
          participants: [],
          tags: [],
          source_mode: "both",
          asr_provider: "parakeet-mlx",
          llm_provider: "ollama",
          prompt_outputs: {},
        };
        manifests[req.runFolder].prompt_outputs = {};
        emit("pipelineProgress", {
          type: "run-planned",
          runFolder: req.runFolder,
          steps: [
            {
              promptOutputId: "__transcript__",
              label: "Build transcript",
              filename: "transcript.md",
              kind: "transcript",
            },
            ...selectedPrompts.map((prompt) => ({
              promptOutputId: prompt.id,
              label: prompt.label,
              filename: prompt.filename,
              model: prompt.model ?? undefined,
              kind: "prompt",
            })),
          ],
        });
        emit("pipelineProgress", {
          type: "output-start",
          runFolder: req.runFolder,
          promptOutputId: "__transcript__",
          label: "Build transcript",
          filename: "transcript.md",
        });
        docs[req.runFolder] ??= {};
        docs[req.runFolder]["transcript.md"] =
          "---\nsource: mock\n---\n### Me\n\n`00:00` Welcome everyone.\n\n`00:18` Let's lock the next steps before we wrap.\n";
        files[req.runFolder] = [
          ...(files[req.runFolder] ?? []).filter((file) => file.name !== "transcript.md"),
          { name: "transcript.md", size: 120, kind: "document" },
          ...((files[req.runFolder] ?? []).filter((file) => file.name !== "transcript.md")),
        ].filter((file, index, all) => all.findIndex((candidate) => candidate.name === file.name) === index);
        emit("pipelineProgress", {
          type: "output-complete",
          runFolder: req.runFolder,
          promptOutputId: "__transcript__",
          label: "Build transcript",
          filename: "transcript.md",
          latencyMs: 500,
        });

        selectedPrompts.forEach((prompt) => {
          const failureKey = `${req.runFolder}::${prompt.id}`;
          const configuredFailure = failedPromptOutputs[failureKey];
          ensurePromptSection(req.runFolder, prompt.id, configuredFailure ? "failed" : "running");
          emit("pipelineProgress", {
            type: "output-start",
            runFolder: req.runFolder,
            promptOutputId: prompt.id,
            label: prompt.label,
            filename: prompt.filename,
            model: prompt.model ?? undefined,
          });
          if (configuredFailure) {
            manifests[req.runFolder].prompt_outputs[prompt.id] = {
              ...manifests[req.runFolder].prompt_outputs[prompt.id],
              status: "failed",
              error: configuredFailure,
            };
            emit("pipelineProgress", {
              type: "output-failed",
              runFolder: req.runFolder,
              promptOutputId: prompt.id,
              label: prompt.label,
              filename: prompt.filename,
              error: configuredFailure,
              latencyMs: 800,
            });
            return;
          }
          writePromptOutput(req.runFolder, prompt.id);
          emit("pipelineProgress", {
            type: "output-complete",
            runFolder: req.runFolder,
            promptOutputId: prompt.id,
            label: prompt.label,
            filename: prompt.filename,
            latencyMs: 800,
          });
        });

        const failed = selectedPrompts
          .map((prompt) => prompt.id)
          .filter((promptId) => failedPromptOutputs[`${req.runFolder}::${promptId}`]);
        const succeeded = selectedPrompts
          .map((prompt) => prompt.id)
          .filter((promptId) => !failedPromptOutputs[`${req.runFolder}::${promptId}`]);
        if (run) run.status = failed.length > 0 ? "error" : "complete";
        buildRunComplete(req.runFolder, succeeded, failed);
        persistState();
        upsertJob({
          ...job,
          status: failed.length > 0 ? "failed" : "completed",
          cancelable: false,
          endedAt: new Date().toISOString(),
          progress: {
            completedOutputs: 1 + succeeded.length,
            failedOutputs: failed.length,
            totalOutputs,
            currentOutputLabel:
              selectedPrompts[selectedPrompts.length - 1]?.label ?? "Build transcript",
          },
          error: failed.length > 0 ? failedPromptOutputs[`${req.runFolder}::${failed[0]}`] : undefined,
        });
      };

      if (background) {
        setTimeout(execute, 0);
        return undefined;
      }

      execute();
      return {
        runFolder: req.runFolder,
        succeeded: promptIds,
        failed: [],
      };
    };

    window.__MEETING_NOTES_TEST = {
      emitAppAction(type, source = "tray") {
        emit("appAction", { type, source });
      },
      navigate() {},
      navigateRoute() {},
      resetState() {
        window.sessionStorage.removeItem(stateStorageKey);
        window.sessionStorage.removeItem(promptsStorageKey);
      },
      removeRunFolder(runFolder) {
        missingFolders.add(runFolder);
        persistState();
      },
      removeAttachmentDirectory(runFolder) {
        missingAttachmentDirs.add(runFolder);
        persistState();
      },
      removeDocument(runFolder, fileName) {
        if (docs[runFolder]) delete docs[runFolder][fileName];
        if (files[runFolder]) {
          files[runFolder] = files[runFolder].filter((file) => file.name !== fileName);
        }
        persistState();
      },
      failPromptOutput(runFolder, promptId, error = "Mock prompt failure") {
        failedPromptOutputs[`${runFolder}::${promptId}`] = error;
        persistState();
      },
      clearPromptFailure(runFolder, promptId) {
        delete failedPromptOutputs[`${runFolder}::${promptId}`];
        persistState();
      },
      setDependencyState(overrides) {
        Object.assign(depsState, overrides);
        persistState();
      },
      getLastExternalAction() {
        return clone(externalActionLog[0] ?? null);
      },
    };

    window.api = {
      config: {
        async get() {
          return clone(config);
        },
        async save(next) {
          Object.assign(config, next);
          persistState();
        },
        async initProject() {},
        async setDataPath(newPath) {
          config.data_path = newPath;
          persistState();
          return { from: "/old", to: newPath };
        },
        async setObsidianEnabled(enabled) {
          config.obsidian_integration.enabled = enabled;
          persistState();
        },
        async setObsidianVault(vaultPath) {
          config.obsidian_integration.vault_path = vaultPath;
          config.obsidian_integration.vault_name = "Mock Vault";
          persistState();
        },
        async openDataDirectory() {
          recordExternalAction("open-data-directory", { path: config.data_path });
        },
        async pickDirectory() {
          return "/Users/test/Documents";
        },
        async pickMediaFile() {
          return { token: "picked-media", name: "mock-meeting.mp4" };
        },
      },
      recording: {
        async getStatus() {
          return clone(recording);
        },
        async start(req) {
          const liveFolder = "/runs/live-meeting";
          recording = {
            active: true,
            run_id: "run-recording",
            title: req.title,
            started_at: "2026-04-08T20:00:00.000Z",
            run_folder: liveFolder,
            system_captured: true,
          };
          missingFolders.delete(liveFolder);
          docs[liveFolder] = {
            "notes.md": "# Live Meeting\n\n",
            "transcript.md": "---\nsource: mock\n---\n",
          };
          prepDocs[liveFolder] = "";
          attachmentsByRun[liveFolder] ??= [];
          files[liveFolder] = [
            { name: "notes.md", size: 32, kind: "document" },
            { name: "transcript.md", size: 24, kind: "document" },
            { name: "audio/mic.wav", size: 3200000, kind: "media" },
            { name: "audio/system.wav", size: 5200000, kind: "media" },
          ];
          manifests[liveFolder] = {
            description: req.description,
            participants: [],
            tags: [],
            source_mode: "both",
            asr_provider: "parakeet-mlx",
            llm_provider: "ollama",
            prompt_outputs: {},
          };
          persistState();
          emit("recordingStatus", clone(recording));
          return { run_folder: liveFolder, run_id: "run-recording" };
        },
        async startForDraft(req) {
          ensureRunAvailable(req.runFolder, { prune: true });
          const existing = runs.find((run) => run.folder_path === req.runFolder);
          recording = {
            active: true,
            run_id: existing?.run_id ?? `run-${nextRunCounter}`,
            title: existing?.title ?? "Draft meeting",
            started_at: existing?.started ?? "2026-04-08T20:00:00.000Z",
            run_folder: req.runFolder,
            system_captured: true,
          };
          if (existing) existing.status = "recording";
          files[req.runFolder] ??= [];
          if (!files[req.runFolder].some((file) => file.name === "audio/mic.wav")) {
            files[req.runFolder].push({ name: "audio/mic.wav", size: 3200000, kind: "media" });
          }
          if (!files[req.runFolder].some((file) => file.name === "audio/system.wav")) {
            files[req.runFolder].push({ name: "audio/system.wav", size: 5200000, kind: "media" });
          }
          docs[req.runFolder] ??= { "notes.md": "# Draft meeting\n\n" };
          manifests[req.runFolder] ??= {
            description: existing?.description ?? null,
            participants: [],
            tags: existing?.tags ?? [],
            source_mode: existing?.source_mode ?? "both",
            asr_provider: "parakeet-mlx",
            llm_provider: "ollama",
            prompt_outputs: {},
          };
          persistState();
          emit("recordingStatus", clone(recording));
          return { run_folder: req.runFolder, run_id: recording.run_id };
        },
        async continueRecording(req) {
          return this.startForDraft(req);
        },
        async pause() {
          recording = { ...recording, paused: true };
          persistState();
          emit("recordingStatus", clone(recording));
        },
        async resume() {
          recording = { ...recording, paused: false };
          persistState();
          emit("recordingStatus", clone(recording));
        },
        async stop(req) {
          const currentFolder = recording.run_folder ?? "/runs/live-meeting";
          ensureRunAvailable(currentFolder, { prune: false });
          if (req?.mode === "delete") {
            pruneRun(currentFolder);
            recording = { active: false };
            emit("recordingStatus", clone(recording));
            return { deleted: true };
          }

          const existingRun = runs.find((run) => run.folder_path === currentFolder);
          const liveRun = {
            run_id: existingRun?.run_id ?? "run-recording",
            title: existingRun?.title ?? recording.title ?? "Untitled Meeting",
            description: existingRun?.description ?? null,
            date: "2026-04-08",
            started: existingRun?.started ?? recording.started_at ?? "2026-04-08T20:00:00.000Z",
            ended: "2026-04-08T20:30:00.000Z",
            status: req?.mode === "process" || !req?.mode ? "processing" : "draft",
            source_mode: existingRun?.source_mode ?? "both",
            duration_minutes: 30,
            tags: existingRun?.tags ?? [],
            folder_path: currentFolder,
            prompt_output_ids: req?.mode === "process" || !req?.mode ? ["summary"] : [],
          };
          if (existingRun) Object.assign(existingRun, liveRun);
          else runs.unshift(liveRun);
          manifests[currentFolder] ??= {
            description: liveRun.description,
            participants: [],
            tags: liveRun.tags,
            source_mode: liveRun.source_mode,
            asr_provider: "parakeet-mlx",
            llm_provider: "ollama",
            prompt_outputs: {},
          };
          manifests[currentFolder].prompt_outputs = {};
          docs[currentFolder] ??= {};
          docs[currentFolder]["transcript.md"] =
            "---\nsource: mock\n---\n### Me\n\n`00:00` Welcome everyone.\n\n`00:18` Let's lock the next steps before we wrap.\n";
          files[currentFolder] = [
            { name: "notes.md", size: 32, kind: "document" },
            { name: "transcript.md", size: 120, kind: "document" },
            { name: "audio/mic.wav", size: 3200000, kind: "media" },
            { name: "audio/system.wav", size: 5200000, kind: "media" },
          ];
          recording = { active: false };
          persistState();
          emit("recordingStatus", clone(recording));
          if (req?.mode === "process" || !req?.mode) {
            processRecordedRun(
              { runFolder: currentFolder, onlyIds: ["summary"] },
              { background: true }
            );
          }
          return { run_folder: currentFolder };
        },
        async listAudioDevices() {
          return [{ name: "Built-in Mic" }, { name: "BlackHole 2ch" }];
        },
      },
      runs: {
        async list() {
          [...missingFolders].forEach((folder) => pruneRun(folder));
          return clone(runs);
        },
        async get(runFolder) {
          return clone(getRun(runFolder));
        },
        async readDocument(runFolder, fileName) {
          ensureRunAvailable(runFolder, { prune: true });
          const content = docs[runFolder]?.[fileName];
          if (content == null) {
            throw new Error(`ENOENT: no such file or directory, open '${runFolder}/${fileName}'`);
          }
          return content;
        },
        async getMediaSource(runFolder, fileName) {
          ensureRunAvailable(runFolder, { prune: true });
          return `mock-media://${fileName}`;
        },
        async downloadMedia(runFolder) {
          ensureRunAvailable(runFolder, { prune: true });
          return { canceled: false };
        },
        async deleteMedia(runFolder, fileName) {
          ensureRunAvailable(runFolder, { prune: true });
          files[runFolder] = (files[runFolder] ?? []).filter((file) => file.name !== fileName);
          persistState();
        },
        async writeNotes(runFolder, content) {
          ensureRunAvailable(runFolder, { prune: true });
          docs[runFolder]["notes.md"] = content;
          persistState();
        },
        async startProcessRecording(req) {
          processRecordedRun(req, { background: true });
        },
        async processRecording(req) {
          return processRecordedRun(req, { background: false });
        },
        async startReprocess(req) {
          ensureRunAvailable(req.runFolder, { prune: true });
          const run = runs.find((item) => item.folder_path === req.runFolder);
          const selectedPromptId = req.onlyIds?.[0] ?? "summary";
          const selectedPrompt = getPromptDefinition(selectedPromptId);
          const job = {
            id: `job-${nextJobCounter++}`,
            kind: req.onlyIds?.length === 1 ? "run-prompt" : "reprocess-run",
            status: "running",
            title: run?.title ?? "Meeting",
            subtitle: req.onlyIds?.length === 1 ? "Running a selected prompt for this meeting" : "Reprocessing meeting outputs",
            createdAt: new Date().toISOString(),
            startedAt: new Date().toISOString(),
            cancelable: true,
            runFolder: req.runFolder,
            promptIds: req.onlyIds,
            provider: "ollama",
            model: "qwen3.5:9b",
            progress: {
              completedOutputs: 0,
              failedOutputs: 0,
              totalOutputs: req.onlyIds?.length ?? 1,
              currentOutputLabel: selectedPrompt.label,
            },
          };
          upsertJob(job);
          setTimeout(() => {
            if (run) run.status = "processing";
            const failureKey = `${req.runFolder}::${selectedPromptId}`;
            const configuredFailure = failedPromptOutputs[failureKey];
            ensurePromptSection(req.runFolder, selectedPromptId, configuredFailure ? "failed" : "running");
            emit("pipelineProgress", {
              type: "output-start",
              runFolder: req.runFolder,
              promptOutputId: selectedPrompt.id,
              label: selectedPrompt.label,
              filename: selectedPrompt.filename,
              model: "qwen3.5:9b",
            });
            if (configuredFailure) {
              manifests[req.runFolder].prompt_outputs[selectedPrompt.id] = {
                ...manifests[req.runFolder].prompt_outputs[selectedPrompt.id],
                status: "failed",
                error: configuredFailure,
              };
              emit("pipelineProgress", {
                type: "output-failed",
                runFolder: req.runFolder,
                promptOutputId: selectedPrompt.id,
                label: selectedPrompt.label,
                filename: selectedPrompt.filename,
                error: configuredFailure,
                latencyMs: 800,
              });
              if (run) run.status = "error";
              emit("pipelineProgress", {
                type: "run-complete",
                runFolder: req.runFolder,
                succeeded: [],
                failed: [selectedPromptId],
              });
            } else {
              writePromptOutput(req.runFolder, selectedPromptId);
              emit("pipelineProgress", {
                type: "output-complete",
                runFolder: req.runFolder,
                promptOutputId: selectedPrompt.id,
                label: selectedPrompt.label,
                filename: selectedPrompt.filename,
                latencyMs: 800,
              });
              if (run) run.status = "complete";
              emit("pipelineProgress", {
                type: "run-complete",
                runFolder: req.runFolder,
                succeeded: req.onlyIds ?? ["summary"],
                failed: [],
              });
            }
            persistState();
            upsertJob({
              ...job,
              status: configuredFailure ? "failed" : "completed",
              cancelable: false,
              endedAt: new Date().toISOString(),
              progress: {
                completedOutputs: configuredFailure ? 0 : 1,
                failedOutputs: configuredFailure ? 1 : 0,
                totalOutputs: req.onlyIds?.length ?? 1,
                currentOutputLabel: selectedPrompt.label,
              },
              error: configuredFailure || undefined,
            });
          }, 0);
        },
        async reprocess(req) {
          ensureRunAvailable(req.runFolder, { prune: true });
          const run = runs.find((item) => item.folder_path === req.runFolder);
          const selectedPromptId = req.onlyIds?.[0] ?? "summary";
          const selectedPrompt = getPromptDefinition(selectedPromptId);
          const job = {
            id: `job-${nextJobCounter++}`,
            kind: req.onlyIds?.length === 1 ? "run-prompt" : "reprocess-run",
            status: "running",
            title: run?.title ?? "Meeting",
            subtitle: req.onlyIds?.length === 1 ? "Running a selected prompt for this meeting" : "Reprocessing meeting outputs",
            createdAt: new Date().toISOString(),
            startedAt: new Date().toISOString(),
            cancelable: true,
            runFolder: req.runFolder,
            promptIds: req.onlyIds,
            provider: "ollama",
            model: "qwen3.5:9b",
            progress: {
              completedOutputs: 0,
              failedOutputs: 0,
              totalOutputs: req.onlyIds?.length ?? 1,
              currentOutputLabel: selectedPrompt.label,
            },
          };
          upsertJob(job);
          if (run) run.status = "processing";
          const failureKey = `${req.runFolder}::${selectedPromptId}`;
          const configuredFailure = failedPromptOutputs[failureKey];
          ensurePromptSection(req.runFolder, selectedPromptId, configuredFailure ? "failed" : "running");
          emit("pipelineProgress", {
            type: "output-start",
            runFolder: req.runFolder,
            promptOutputId: selectedPrompt.id,
            label: selectedPrompt.label,
            filename: selectedPrompt.filename,
            model: "qwen3.5:9b",
          });
          if (configuredFailure) {
            manifests[req.runFolder].prompt_outputs[selectedPrompt.id] = {
              ...manifests[req.runFolder].prompt_outputs[selectedPrompt.id],
              status: "failed",
              error: configuredFailure,
            };
            emit("pipelineProgress", {
              type: "output-failed",
              runFolder: req.runFolder,
              promptOutputId: selectedPrompt.id,
              label: selectedPrompt.label,
              filename: selectedPrompt.filename,
              error: configuredFailure,
              latencyMs: 800,
            });
            if (run) run.status = "error";
            emit("pipelineProgress", {
              type: "run-complete",
              runFolder: req.runFolder,
              succeeded: [],
              failed: [selectedPromptId],
            });
          } else {
            writePromptOutput(req.runFolder, selectedPromptId);
            emit("pipelineProgress", {
              type: "output-complete",
              runFolder: req.runFolder,
              promptOutputId: selectedPrompt.id,
              label: selectedPrompt.label,
              filename: selectedPrompt.filename,
              latencyMs: 800,
            });
            if (run) run.status = "complete";
            emit("pipelineProgress", {
              type: "run-complete",
              runFolder: req.runFolder,
              succeeded: req.onlyIds ?? ["summary"],
              failed: [],
            });
          }
          persistState();
          upsertJob({
            ...job,
            status: configuredFailure ? "failed" : "completed",
            cancelable: false,
            endedAt: new Date().toISOString(),
            progress: {
              completedOutputs: configuredFailure ? 0 : 1,
              failedOutputs: configuredFailure ? 1 : 0,
              totalOutputs: req.onlyIds?.length ?? 1,
              currentOutputLabel: selectedPrompt.label,
            },
            error: configuredFailure || undefined,
          });
          return {
            runFolder: req.runFolder,
            succeeded: configuredFailure ? [] : req.onlyIds ?? ["summary"],
            failed: configuredFailure ? [selectedPromptId] : [],
          };
        },
        async bulkReprocess(req) {
          return req.runFolders.map((runFolder) => {
            if (missingFolders.has(runFolder)) {
              pruneRun(runFolder);
              return {
                runFolder,
                succeeded: [],
                failed: [],
                error: "This meeting no longer exists on disk.",
              };
            }
            return {
              runFolder,
              succeeded: req.onlyIds ?? ["summary"],
              failed: [],
            };
          });
        },
        async processMedia(_token, title) {
          const folder = `/runs/imported-${nextRunCounter++}`;
          runs.unshift({
            run_id: folder,
            title,
            description: "Imported meeting",
            date: "2026-04-08",
            started: "2026-04-08T21:00:00.000Z",
            ended: "2026-04-08T21:15:00.000Z",
            status: "complete",
            source_mode: "file",
            duration_minutes: 15,
            tags: [],
            folder_path: folder,
            prompt_output_ids: [],
          });
          manifests[folder] = {
            description: "Imported meeting",
            participants: [],
            tags: [],
            source_mode: "file",
            asr_provider: "parakeet-mlx",
            llm_provider: "ollama",
            prompt_outputs: {},
          };
          files[folder] = [
            { name: "notes.md", size: 48, kind: "document" },
            { name: "transcript.md", size: 80, kind: "document" },
            { name: "audio/mock-meeting.mp4", size: 11400000, kind: "media" },
          ];
          docs[folder] = {
            "notes.md": "# Imported meeting\n\n",
            "transcript.md": "---\nsource: mock\n---\n### Others\n\n`00:00` Imported transcript\n",
          };
          prepDocs[folder] = "";
          attachmentsByRun[folder] = [];
          persistState();
          upsertJob({
            id: `job-${nextJobCounter++}`,
            kind: "process-import",
            status: "running",
            title,
            subtitle: "Processing imported media",
            createdAt: new Date().toISOString(),
            startedAt: new Date().toISOString(),
            cancelable: true,
            runFolder: folder,
            provider: "ollama",
            model: "qwen3.5:9b",
            progress: {
              completedOutputs: 0,
              failedOutputs: 0,
              totalOutputs: 1,
              currentOutputLabel: "Summary + Action Items",
            },
          });
          return { run_folder: folder };
        },
        async processDroppedMedia(_file, title) {
          return this.processMedia("dropped", title);
        },
        async openInObsidian(runFolder, target) {
          recordExternalAction("open-in-obsidian", { runFolder, target });
        },
        async openInFinder(runFolder) {
          recordExternalAction("open-run-in-finder", { runFolder });
        },
        async deleteRun(runFolder) {
          pruneRun(runFolder);
        },
        async bulkDelete(runFolders) {
          for (const folder of runFolders) {
            pruneRun(folder);
          }
        },
        async createDraft(req) {
          const folder = `/runs/draft-${nextRunCounter++}`;
          const run = {
            run_id: `run-draft-${nextRunCounter}`,
            title: req.title,
            description: req.description ?? null,
            date: "2026-04-08",
            started: req.scheduledTime ?? "2026-04-08T22:00:00.000Z",
            ended: null,
            status: "draft",
            source_mode: "both",
            duration_minutes: null,
            tags: [],
            folder_path: folder,
            prompt_output_ids: [],
            scheduled_time: req.scheduledTime ?? null,
          };
          runs.unshift(run);
          manifests[folder] = {
            description: run.description,
            participants: [],
            tags: [],
            source_mode: "both",
            asr_provider: "parakeet-mlx",
            llm_provider: "ollama",
            prompt_outputs: {},
          };
          docs[folder] = { "notes.md": "# Draft notes\n\n" };
          prepDocs[folder] = "";
          files[folder] = [{ name: "notes.md", size: 18, kind: "document" }];
          attachmentsByRun[folder] = [];
          persistState();
          return { run_folder: folder, run_id: run.run_id };
        },
        async writePrep(runFolder, content) {
          ensureRunAvailable(runFolder, { prune: true });
          prepDocs[runFolder] = content;
          persistState();
        },
        async readPrep(runFolder) {
          ensureRunAvailable(runFolder, { prune: true });
          return prepDocs[runFolder] ?? "";
        },
        async addAttachment(runFolder) {
          ensureRunAvailable(runFolder, { prune: true });
          const next = {
            fileName: `attachment-${(attachmentsByRun[runFolder]?.length ?? 0) + 1}.pdf`,
            size: 20480,
          };
          attachmentsByRun[runFolder] ??= [];
          attachmentsByRun[runFolder].push({ name: next.fileName, size: next.size });
          persistState();
          return next;
        },
        async removeAttachment(runFolder, fileName) {
          ensureRunAvailable(runFolder, { prune: true });
          attachmentsByRun[runFolder] = (attachmentsByRun[runFolder] ?? []).filter((file) => file.name !== fileName);
          persistState();
        },
        async listAttachments(runFolder) {
          if (missingFolders.has(runFolder) || missingAttachmentDirs.has(runFolder)) {
            if (missingFolders.has(runFolder)) pruneRun(runFolder);
            return [];
          }
          return clone(attachmentsByRun[runFolder] ?? []);
        },
        async updatePrep(req) {
          ensureRunAvailable(req.runFolder, { prune: true });
          const run = runs.find((item) => item.folder_path === req.runFolder);
          if (run && "scheduledTime" in req) {
            run.scheduled_time = req.scheduledTime ?? null;
          }
          persistState();
        },
        async updateMeta(req) {
          ensureRunAvailable(req.runFolder, { prune: true });
          const run = runs.find((item) => item.folder_path === req.runFolder);
          if (run && "description" in req) run.description = req.description;
          if (run && "title" in req && req.title) run.title = req.title;
          persistState();
        },
        async reopenAsDraft(runFolder) {
          ensureRunAvailable(runFolder, { prune: true });
          const run = runs.find((item) => item.folder_path === runFolder);
          if (run) run.status = "draft";
          persistState();
        },
        async markComplete(runFolder) {
          ensureRunAvailable(runFolder, { prune: true });
          const run = runs.find((item) => item.folder_path === runFolder);
          if (run) run.status = "complete";
          persistState();
        },
      },
      prompts: {
        async list() {
          return clone(prompts);
        },
        async save(id, body, patch) {
          const prompt = prompts.find((item) => item.id === id);
          if (!prompt) return;
          Object.assign(prompt, patch);
          prompt.body = body;
          persistPromptState();
        },
        async create(id, label, filename, body) {
          prompts.push({
            id,
            label,
            description: null,
            sort_order: prompts.length + 1,
                filename,
            enabled: false,
            auto: false,
            builtin: false,
            model: null,
            source_path: `/Users/test/.meeting-notes/prompts/${id}.md`,
            body,
          });
          persistPromptState();
        },
        async enable(id, enabled) {
          const prompt = prompts.find((item) => item.id === id);
          if (prompt) {
            prompt.enabled = enabled;
            persistPromptState();
          }
        },
        async setAuto(id, auto) {
          const prompt = prompts.find((item) => item.id === id);
          if (prompt) {
            prompt.auto = auto;
            prompt.enabled = auto;
            persistPromptState();
          }
        },
        async resetToDefault(id) {
          const prompt = prompts.find((item) => item.id === id);
          if (prompt) {
            prompt.body = "Produce a concise summary and action items.";
            persistPromptState();
          }
        },
        async getDir() {
          return "/Users/test/.meeting-notes/prompts";
        },
        async openInFinder(promptId) {
          recordExternalAction("open-prompt-in-finder", { promptId });
        },
      },
      secrets: {
        async has(name) {
          return name === "claude" ? hasClaude : hasOpenai;
        },
        async set(name) {
          if (name === "claude") hasClaude = true;
          if (name === "openai") hasOpenai = true;
          persistState();
        },
      },
      async setupAsr() {},
      llm: {
        async check() {
          return {
            daemon: true,
            source: "bundled-spawned",
            installedModels: clone(installedLocalModels),
          };
        },
        async setup({ model }) {
          if (!installedLocalModels.includes(model)) installedLocalModels.push(model);
          emit("setupLlmLog", `Pulled ${model}`);
          persistState();
        },
        async listInstalled() {
          return clone(installedLocalModels);
        },
        async remove(model) {
          const index = installedLocalModels.indexOf(model);
          if (index !== -1) installedLocalModels.splice(index, 1);
          persistState();
        },
        async runtime() {
          return {
            available: true,
            source: "bundled-spawned",
            models: [
              {
                model: "qwen3.5:9b",
                name: "qwen3.5:9b",
                size: 5400000000,
                size_vram: 4100000000,
                expires_at: "2026-04-08T20:15:00.000Z",
                details: {
                  parameter_size: "9B",
                  quantization_level: "Q4_K_M",
                  family: "qwen",
                  format: "gguf",
                },
              },
            ],
          };
        },
      },
      jobs: {
        async list() {
          return clone(jobs);
        },
        async cancel(jobId) {
          const index = jobs.findIndex((job) => job.id === jobId);
          if (index === -1) return;
          jobs[index] = {
            ...jobs[index],
            status: "canceled",
            cancelable: false,
            endedAt: new Date().toISOString(),
          };
          emit("jobUpdate", clone(jobs[index]));
        },
        async tailLog(jobId) {
          return `log for job ${jobId}`;
        },
      },
      system: {
        async detectHardware() {
          return {
            arch: "arm64",
            platform: "darwin",
            totalRamGb: 32,
            chip: "Apple M3 Pro",
            appleSilicon: true,
          };
        },
      },
      logs: {
        async tailApp() {
          return appLogEntries
            .slice()
            .reverse()
            .map((entry) => {
              const suffix = entry.data && Object.keys(entry.data).length > 0
                ? ` ${JSON.stringify(entry.data)}`
                : "";
              return `[${entry.timestamp}] ${entry.level.toUpperCase().padEnd(5)} [${entry.component}] ${entry.message}${suffix}`;
            })
            .join("\n");
        },
        async tailRun(runFolder) {
          return `log for ${runFolder}`;
        },
        async appPath() {
          return "/Users/test/.meeting-notes/app.log";
        },
        async listAppEntries() {
          return clone(appLogEntries);
        },
        async listProcesses() {
          return clone(processes);
        },
        async reportRendererError(payload) {
          pushLogEntry({
            id: `log-${appLogEntries.length + 1}`,
            timestamp: new Date().toISOString(),
            level: "error",
            component: payload.source,
            message: payload.message,
            detail: payload.detail,
            data: {
              stack: payload.stack,
              detail: payload.detail,
            },
          });
          upsertProcess({
            id: "process-renderer",
            type: "renderer",
            label: "Renderer error",
            status: "failed",
            startedAt: new Date().toISOString(),
            error: payload.message,
          });
        },
      },
      async depsCheck() {
        return {
          ffmpeg: depsState.ffmpeg,
          ffmpegVersion: depsState.ffmpegVersion,
          blackhole: depsState.blackhole,
          python: depsState.python,
          pythonVersion: depsState.pythonVersion,
          parakeet: depsState.parakeet,
          ollama: {
            daemon: true,
            source: "bundled-spawned",
            installedModels: clone(installedLocalModels),
            version: depsState.ollamaVersion,
          },
        };
      },
      deps: {
        async install(target) {
          emit("depsInstallLog", `Installed ${target}`);
          if (target === "ffmpeg") depsState.ffmpeg = "/opt/homebrew/bin/ffmpeg";
          if (target === "blackhole") depsState.blackhole = "installed-not-loaded";
          persistState();
          return { ok: true };
        },
        async checkBrew() {
          return depsState.brewAvailable;
        },
        async restartAudio() {
          depsState.blackhole = "loaded";
          persistState();
          return { ok: true };
        },
      },
      obsidian: {
        async detectVaults() {
          return [];
        },
      },
      on: {
        recordingStatus(cb) {
          return subscribe("recordingStatus", cb);
        },
        pipelineProgress(cb) {
          return subscribe("pipelineProgress", cb);
        },
        setupAsrLog(cb) {
          return subscribe("setupAsrLog", cb);
        },
        setupLlmLog(cb) {
          return subscribe("setupLlmLog", cb);
        },
        setupLlmProgress(cb) {
          return subscribe("setupLlmProgress", cb);
        },
        depsInstallLog(cb) {
          return subscribe("depsInstallLog", cb);
        },
        appAction(cb) {
          return subscribe("appAction", cb);
        },
        jobUpdate(cb) {
          return subscribe("jobUpdate", cb);
        },
        logEntry(cb) {
          return subscribe("logEntry", cb);
        },
        processUpdate(cb) {
          return subscribe("processUpdate", cb);
        },
      },
    };
  });
}
