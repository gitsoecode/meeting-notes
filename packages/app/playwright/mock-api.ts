import type { Page } from "@playwright/test";

export async function installMockApi(page: Page) {
  await page.addInitScript(() => {
    const listeners = {
      recordingStatus: new Set(),
      pipelineProgress: new Set(),
      setupAsrLog: new Set(),
      setupLlmLog: new Set(),
      depsInstallLog: new Set(),
      appAction: new Set(),
      jobUpdate: new Set(),
      logEntry: new Set(),
      processUpdate: new Set(),
    };

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
          },
          "decision-log": {
            status: "complete",
            label: "Decision Log",
            filename: "decision-log.md",
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
      emit("jobUpdate", clone(job));
    };
    const upsertProcess = (process) => {
      const index = processes.findIndex((item) => item.id === process.id);
      if (index === -1) processes.unshift(process);
      else processes[index] = process;
      emit("processUpdate", clone(process));
    };
    const pushLogEntry = (entry) => {
      appLogEntries.unshift(entry);
      emit("logEntry", clone(entry));
    };

    const getRun = (runFolder) => {
      const run = runs.find((item) => item.folder_path === runFolder);
      if (!run) throw new Error("Run not found");
      return {
        ...run,
        manifest: manifests[runFolder],
        files: files[runFolder] ?? [],
      };
    };

    const clone = (value) => JSON.parse(JSON.stringify(value));
    const promptsStorageKey = "__meeting_notes_prompts__";
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
      try {
        window.sessionStorage.setItem(promptsStorageKey, JSON.stringify(prompts));
      } catch {}
    };

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

    const buildRunComplete = (runFolder, succeeded) => {
      emit("pipelineProgress", {
        type: "run-complete",
        runFolder,
        succeeded,
        failed: [],
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
          ensurePromptSection(req.runFolder, prompt.id, "running");
          emit("pipelineProgress", {
            type: "output-start",
            runFolder: req.runFolder,
            promptOutputId: prompt.id,
            label: prompt.label,
            filename: prompt.filename,
            model: prompt.model ?? undefined,
          });
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

        if (run) run.status = "complete";
        buildRunComplete(req.runFolder, promptIds);
        upsertJob({
          ...job,
          status: "completed",
          cancelable: false,
          endedAt: new Date().toISOString(),
          progress: {
            completedOutputs: totalOutputs,
            failedOutputs: 0,
            totalOutputs,
            currentOutputLabel:
              selectedPrompts[selectedPrompts.length - 1]?.label ?? "Build transcript",
          },
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
    };

    window.api = {
      config: {
        async get() {
          return clone(config);
        },
        async save(next) {
          Object.assign(config, next);
        },
        async initProject() {},
        async setDataPath(newPath) {
          config.data_path = newPath;
          return { from: "/old", to: newPath };
        },
        async setObsidianEnabled(enabled) {
          config.obsidian_integration.enabled = enabled;
        },
        async setObsidianVault(vaultPath) {
          config.obsidian_integration.vault_path = vaultPath;
          config.obsidian_integration.vault_name = "Mock Vault";
        },
        async openDataDirectory() {},
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
          recording = {
            active: true,
            run_id: "run-recording",
            title: req.title,
            started_at: "2026-04-08T20:00:00.000Z",
            run_folder: "/runs/live-meeting",
            system_captured: true,
          };
          docs["/runs/live-meeting"] = {
            "notes.md": "# Live Meeting\n\n",
            "transcript.md": "---\nsource: mock\n---\n",
          };
          files["/runs/live-meeting"] = [
            { name: "notes.md", size: 32, kind: "document" },
            { name: "transcript.md", size: 24, kind: "document" },
            { name: "audio/mic.wav", size: 3200000, kind: "media" },
            { name: "audio/system.wav", size: 5200000, kind: "media" },
          ];
          manifests["/runs/live-meeting"] = {
            description: req.description,
            participants: [],
            tags: [],
            source_mode: "both",
            asr_provider: "parakeet-mlx",
            llm_provider: "ollama",
            prompt_outputs: {},
          };
          emit("recordingStatus", clone(recording));
          return { run_folder: "/runs/live-meeting", run_id: "run-recording" };
        },
        async stop(req) {
          if (req?.mode === "delete") {
            delete docs["/runs/live-meeting"];
            delete files["/runs/live-meeting"];
            delete manifests["/runs/live-meeting"];
            const liveRunIndex = runs.findIndex((run) => run.folder_path === "/runs/live-meeting");
            if (liveRunIndex !== -1) runs.splice(liveRunIndex, 1);
            recording = { active: false };
            emit("recordingStatus", clone(recording));
            return { deleted: true };
          }

          const liveRun = {
            run_id: "run-recording",
            title: recording.title ?? "Untitled Meeting",
            description: null,
            date: "2026-04-08",
            started: "2026-04-08T20:00:00.000Z",
            ended: "2026-04-08T20:30:00.000Z",
            status: "complete",
            source_mode: "both",
            duration_minutes: 30,
            tags: [],
            folder_path: "/runs/live-meeting",
            prompt_output_ids: req?.mode === "process" || !req?.mode ? ["summary"] : [],
          };
          runs.unshift(liveRun);
          manifests["/runs/live-meeting"].prompt_outputs = {};
          docs["/runs/live-meeting"]["transcript.md"] =
            "---\nsource: mock\n---\n### Me\n\n`00:00` Welcome everyone.\n\n`00:18` Let's lock the next steps before we wrap.\n";
          files["/runs/live-meeting"] = [
            { name: "notes.md", size: 32, kind: "document" },
            { name: "transcript.md", size: 120, kind: "document" },
            { name: "audio/mic.wav", size: 3200000, kind: "media" },
            { name: "audio/system.wav", size: 5200000, kind: "media" },
          ];
          recording = { active: false };
          emit("recordingStatus", clone(recording));
          if (req?.mode === "process" || !req?.mode) {
            processRecordedRun(
              { runFolder: "/runs/live-meeting", onlyIds: ["summary"] },
              { background: true }
            );
          }
          return { run_folder: "/runs/live-meeting" };
        },
        async listAudioDevices() {
          return [{ name: "Built-in Mic" }, { name: "BlackHole 2ch" }];
        },
      },
      runs: {
        async list() {
          return clone(runs);
        },
        async get(runFolder) {
          return clone(getRun(runFolder));
        },
        async readDocument(runFolder, fileName) {
          const content = docs[runFolder]?.[fileName];
          if (content == null) {
            throw new Error(`ENOENT: no such file or directory, open '${runFolder}/${fileName}'`);
          }
          return content;
        },
        async getMediaSource(_runFolder, fileName) {
          return `mock-media://${fileName}`;
        },
        async downloadMedia() {
          return { canceled: false };
        },
        async deleteMedia(runFolder, fileName) {
          files[runFolder] = (files[runFolder] ?? []).filter((file) => file.name !== fileName);
        },
        async writeNotes(runFolder, content) {
          docs[runFolder]["notes.md"] = content;
        },
        async startProcessRecording(req) {
          processRecordedRun(req, { background: true });
        },
        async processRecording(req) {
          return processRecordedRun(req, { background: false });
        },
        async startReprocess(req) {
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
            ensurePromptSection(req.runFolder, selectedPromptId, "running");
            emit("pipelineProgress", {
              type: "output-start",
              runFolder: req.runFolder,
              promptOutputId: selectedPrompt.id,
              label: selectedPrompt.label,
              filename: selectedPrompt.filename,
              model: "qwen3.5:9b",
            });
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
            upsertJob({
              ...job,
              status: "completed",
              cancelable: false,
              endedAt: new Date().toISOString(),
              progress: {
                completedOutputs: 1,
                failedOutputs: 0,
                totalOutputs: req.onlyIds?.length ?? 1,
                currentOutputLabel: selectedPrompt.label,
              },
            });
          }, 0);
        },
        async reprocess(req) {
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
          ensurePromptSection(req.runFolder, selectedPromptId, "running");
          emit("pipelineProgress", {
            type: "output-start",
            runFolder: req.runFolder,
            promptOutputId: selectedPrompt.id,
            label: selectedPrompt.label,
            filename: selectedPrompt.filename,
            model: "qwen3.5:9b",
          });
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
          upsertJob({
            ...job,
            status: "completed",
            cancelable: false,
            endedAt: new Date().toISOString(),
            progress: {
              completedOutputs: 1,
              failedOutputs: 0,
              totalOutputs: req.onlyIds?.length ?? 1,
              currentOutputLabel: selectedPrompt.label,
            },
          });
          return {
            runFolder: req.runFolder,
            succeeded: req.onlyIds ?? ["summary"],
            failed: [],
          };
        },
        async bulkReprocess(req) {
          return req.runFolders.map((runFolder) => ({
            runFolder,
            succeeded: req.onlyIds ?? ["summary"],
            failed: [],
          }));
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
        async openInObsidian() {},
        async openInFinder() {},
        async deleteRun(runFolder) {
          const index = runs.findIndex((run) => run.folder_path === runFolder);
          if (index !== -1) runs.splice(index, 1);
        },
        async bulkDelete(runFolders) {
          for (const folder of runFolders) {
            const index = runs.findIndex((run) => run.folder_path === folder);
            if (index !== -1) runs.splice(index, 1);
          }
        },
        async updateMeta(req) {
          const run = runs.find((item) => item.folder_path === req.runFolder);
          if (run && "description" in req) run.description = req.description;
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
        async openInFinder() {},
      },
      secrets: {
        async has(name) {
          return name === "claude" ? hasClaude : hasOpenai;
        },
        async set(name) {
          if (name === "claude") hasClaude = true;
          if (name === "openai") hasOpenai = true;
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
        },
        async listInstalled() {
          return clone(installedLocalModels);
        },
        async remove(model) {
          const index = installedLocalModels.indexOf(model);
          if (index !== -1) installedLocalModels.splice(index, 1);
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
          ffmpeg: "/opt/homebrew/bin/ffmpeg",
          blackhole: "loaded",
          python: "/usr/bin/python3",
          parakeet: "/Users/test/.meeting-notes/parakeet",
          ollama: {
            daemon: true,
            source: "bundled-spawned",
            installedModels: clone(installedLocalModels),
          },
        };
      },
      deps: {
        async install(target) {
          emit("depsInstallLog", `Installed ${target}`);
          return { ok: true };
        },
        async checkBrew() {
          return true;
        },
        async restartAudio() {
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
