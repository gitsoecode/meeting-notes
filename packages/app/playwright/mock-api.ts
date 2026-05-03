import type { Page } from "@playwright/test";

export async function installMockApi(page: Page) {
  await page.addInitScript(() => {
    const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

    // Generate a tiny valid WAV as raw bytes for audio playback tests.
    function generateTinyWavBytes(): Uint8Array {
      const sampleRate = 8000;
      const numSamples = 800;
      const dataSize = numSamples * 2;
      const buf = new ArrayBuffer(44 + dataSize);
      const view = new DataView(buf);
      const writeStr = (offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
      };
      writeStr(0, "RIFF");
      view.setUint32(4, 36 + dataSize, true);
      writeStr(8, "WAVE");
      writeStr(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeStr(36, "data");
      view.setUint32(40, dataSize, true);
      for (let i = 0; i < numSamples; i++) {
        view.setInt16(44 + i * 2, Math.round(Math.sin(i * 0.1) * 1000), true);
      }
      return new Uint8Array(buf);
    }
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
      audioMonitorLevels: new Set(),
      meetingIndexBackfillProgress: new Set(),
      installerProgress: new Set(),
      updaterStatus: new Set(),
    };
    const stateStorageKey = "__gistlist_mock_state__";
    const promptsStorageKey = "__gistlist_prompts__";

    const config = {
      data_path: "/Users/test/Gistlist",
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
        binary_path: "/Users/test/.gistlist/parakeet",
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
        system_device: "",
      },
      shortcuts: {
        toggle_recording: "CommandOrControl+Shift+M",
      },
      audio_retention_days: null,
      audio_storage_mode: "compact",
    };

    let hasClaude = true;
    let hasOpenai = false;
    let recording = {
      active: false,
    };
    let nextRunCounter = 3;
    let nextJobCounter = 2;
    // Opt-in test hook: when > 0, startReprocess emits a chain of
    // output-progress events before output-complete, spaced by this many
    // ms. Lets tests observe the live token-count tick expected from
    // streaming LLM providers (Claude, OpenAI). Zero = old synchronous
    // behavior, used by the bulk of specs.
    let progressEmissionDelayMs = 0;
    // Tracks the embedding model state for the new dedicated row on the
    // Dependencies wizard step. Defaults to true so most existing specs
    // (which don't care about semantic search) continue to walk through
    // the wizard without an extra install row blocking Finish. Specs
    // that exercise the not-yet-installed path flip this via
    // `__MEETING_NOTES_TEST.setEmbedModelInstalled(false)`.
    let embedModelInstalled = true;
    // Counter for the no-surprise-pull regression test. The renderer's
    // contract is "explicit click only" — Finish must never trigger
    // `installEmbedModel`, and neither should the main process at
    // startup. The Playwright spec asserts this counter stays 0 across
    // the full Finish flow when the user didn't click the dedicated
    // download row.
    let installEmbedModelCallCount = 0;
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
          steps: [],
        },
      },
      {
        id: "job-failed",
        kind: "run-prompt",
        status: "failed",
        title: "Decision log run",
        subtitle: "Decision Log",
        createdAt: "2026-04-08T18:55:00.000Z",
        startedAt: "2026-04-08T18:55:01.000Z",
        endedAt: "2026-04-08T18:56:30.000Z",
        cancelable: false,
        runFolder: "/runs/weekly-planning",
        provider: "ollama",
        model: "qwen3.5:9b",
        progress: {
          completedOutputs: 0,
          failedOutputs: 1,
          totalOutputs: 1,
          steps: [],
        },
        error: "Ollama returned 500",
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
        stack: "TypeError: Cannot read properties of undefined\n    at PromptPreview.tsx:44:12",
        data: {
          stack: "TypeError: Cannot read properties of undefined\n    at PromptPreview.tsx:44:12",
          detail: "PromptPreview.tsx:44:12",
          model: "qwen3.5:9b",
          retries: 2,
        },
      },
      {
        id: "log-2",
        timestamp: "2026-04-08T19:01:04.000Z",
        level: "warn",
        component: "jobs",
        message: "Retrying pipeline section",
        jobId: "job-1",
        runFolder: "/runs/customer-call",
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
        temperature: null,
        source_path: "/Users/test/.gistlist/prompts/summary.md",
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
        temperature: null,
        source_path: "/Users/test/.gistlist/prompts/one-on-one-follow-up.md",
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
        temperature: null,
        source_path: "/Users/test/.gistlist/prompts/decision-log.md",
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
        temperature: null,
        source_path: "/Users/test/.gistlist/prompts/follow-up-brief.md",
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
        folder_size_bytes: 12_400_000,
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
        folder_size_bytes: 8_700_000,
      },
      {
        run_id: "run-3",
        title: "Draft standup",
        description: "Prepared but not yet recorded.",
        date: "2026-04-10",
        started: null,
        ended: null,
        status: "draft",
        source_mode: "both",
        duration_minutes: null,
        tags: [],
        folder_path: "/runs/draft-standup",
        prompt_output_ids: [],
        folder_size_bytes: 1_200,
      },
      {
        run_id: "run-4",
        title: "Failed import",
        description: "Recording that failed during processing.",
        date: "2026-04-09",
        started: "2026-04-09T14:00:00.000Z",
        ended: "2026-04-09T14:30:00.000Z",
        status: "error",
        source_mode: "file",
        duration_minutes: 30,
        tags: ["import"],
        folder_path: "/runs/failed-import",
        prompt_output_ids: ["summary"],
        folder_size_bytes: 3_300_000,
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
      "/runs/draft-standup": {
        description: "Prepared but not yet recorded.",
        participants: [],
        tags: [],
        source_mode: "both",
        asr_provider: "parakeet-mlx",
        llm_provider: "ollama",
        prompt_outputs: {},
      },
      "/runs/failed-import": {
        description: "Recording that failed during processing.",
        participants: ["Jesse"],
        tags: ["import"],
        source_mode: "file",
        asr_provider: "parakeet-mlx",
        llm_provider: "ollama",
        prompt_outputs: {
          summary: {
            status: "failed",
            label: "Summary + Action Items",
            filename: "summary.md",
            model: "qwen3.5:9b",
            error: "Transcription failed: audio file is empty or corrupt.",
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
        { name: "audio/combined.wav", size: 8500000, kind: "media" },
      ],
      "/runs/customer-call": [
        { name: "index.md", size: 180, kind: "document" },
        { name: "notes.md", size: 260, kind: "document" },
        { name: "transcript.md", size: 580, kind: "document" },
        { name: "audio/customer-call.mp4", size: 15800000, kind: "media" },
      ],
      "/runs/draft-standup": [
        { name: "index.md", size: 120, kind: "document" },
      ],
      "/runs/failed-import": [
        { name: "index.md", size: 160, kind: "document" },
        { name: "audio/uploaded.mp4", size: 8200000, kind: "media" },
      ],
    };

    const docs = {
      "/runs/weekly-planning": {
        "notes.md":
          "# Planning Notes\n\nThese are the notes I found:<br />\n\n- Review backlog\n- Confirm owners\n",
        "transcript.md":
          "---\nsource: mock\n---\n### Me\n\n`00:00` Welcome everyone.\n\n`00:15` We need to lock the sprint scope.\n\n`00:22` Quick agenda check before we dive in.\n\n### Others\n\n`00:32` Let's keep the reporting task in.\n\n### Me\n\n`00:45` Sounds good to me.\n\nAnd one more thing — I almost forgot the OKRs.\n\n`01:05` Let's revisit those next week.\n",
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
      "/runs/draft-standup": {},
      "/runs/failed-import": {},
    };
    const prepDocs = {
      "/runs/weekly-planning": "# Prep\n\n- Review backlog\n- Confirm owners\n",
      "/runs/customer-call": "# Customer prep\n\n- Bring pricing notes\n",
      "/runs/draft-standup": "# Standup prep\n\n- Check yesterday's blockers\n",
    };
    const attachmentsByRun = {
      "/runs/weekly-planning": [{ name: "agenda.pdf", size: 32000 }],
      "/runs/customer-call": [],
      "/runs/draft-standup": [],
      "/runs/failed-import": [],
    } as Record<string, Array<{ name: string; size: number }>>;
    const missingFolders = new Set<string>();
    const missingAttachmentDirs = new Set<string>();
    const failedPromptOutputs: Record<string, string> = {};
    const depsState = {
      ffmpeg: "/opt/homebrew/bin/ffmpeg",
      ffmpegVersion: "7.1-mock",
      ffprobe: "/opt/homebrew/bin/ffprobe",
      ffprobeVersion: "7.1-mock",
      blackhole: "missing",
      systemAudioSupported: true,
      python: "/usr/bin/python3",
      pythonVersion: "3.9.6",
      parakeet: "/Users/test/.gistlist/parakeet",
      whisper: "/opt/homebrew/bin/whisper-cli",
      ollama: "/opt/homebrew/bin/ollama" as string | null,
      ollamaVersion: "0.7.2",
      brewAvailable: true,
    } as {
      ffmpeg: string | null;
      ffmpegVersion: string | null;
      ffprobe: string | null;
      ffprobeVersion: string | null;
      blackhole: "missing" | "installed-not-loaded" | "loaded";
      systemAudioSupported: boolean;
      python: string | null;
      pythonVersion: string | null;
      parakeet: string | null;
      whisper: string | null;
      ollama: string | null;
      ollamaVersion: string | null;
      brewAvailable: boolean | null;
    };
    const externalActionLog: Array<{ type: string; payload?: unknown }> = [];
    // Per-target one-shot install-failure overrides. Tests prime these
    // via __MEETING_NOTES_TEST.setNextInstallFailure(...) before clicking
    // an install button; the mock consumes and clears on use.
    const installFailureOverrides = new Map<
      string,
      { ok: false; error?: string; failedPhase?: string }
    >();
    // One-shot setup-asr failure override. Tests prime this via
    // __MEETING_NOTES_TEST.setNextSetupAsrFailure(...) to exercise the
    // {ok: false, error, failedPhase} unhappy paths in the Parakeet chain.
    let mockSetupAsrFailure:
      | { error: string; failedPhase?: string; logLines?: string[] }
      | null = null;
    // Spy state for the Setup Wizard tests. The "Cancel from reopened
    // wizard" assertion needs to verify config:init was NOT called, and
    // the "retention can clear back to null" assertion needs to read the
    // request payload the wizard sent. The real engine.initProject() runs
    // in main; the mock just records calls.
    let initProjectCallCount = 0;
    let lastInitProjectRequest: unknown = null;
    // Permission spy state for the consent-first wizard spec. Asserts that
    // landing on step 4 reads mic status (passive) but never auto-fires
    // requestMicrophonePermission or probeSystemAudioPermission — those
    // only run on explicit button click. Tests can also override the
    // mic permission status to simulate a fresh "not-determined" install.
    let micPermissionStatus:
      | "granted"
      | "denied"
      | "not-determined"
      | "restricted" = "granted";
    const permissionCallCounts = {
      getMicrophonePermission: 0,
      requestMicrophonePermission: 0,
      probeSystemAudioPermission: 0,
    };
    // Updater state — starts in the build-disabled shape so the default
    // mock matches first-beta behavior. Tests flip it via
    // __MEETING_NOTES_TEST.setUpdaterStatus({...}) when they want to
    // exercise the enabled UI surface.
    let updaterStatusState: {
      enabled: boolean;
      kind: string;
      version?: string;
      bytesDone?: number;
      bytesTotal?: number;
      lastChecked?: string;
      error?: string;
      releaseNotesUrl?: string;
    } = { enabled: false, kind: "disabled-at-build" };
    const updaterPrefsState: { autoCheck: boolean; notifyBanner: boolean } = {
      autoCheck: true,
      notifyBanner: true,
    };
    // Meeting-index health/progress mock state. Defaults to a fully
    // healthy index so unrelated specs aren't perturbed. The new
    // settings-meeting-index spec drives these via __MEETING_NOTES_TEST
    // helpers below to exercise pending / fts-only / no-vec / progress
    // states without standing up a real Ollama daemon.
    let meetingIndexHealthState: {
      totalRuns: number;
      pendingRuns: number;
      ftsOnlyRuns: number;
      vecAvailable: boolean;
    } = { totalRuns: 0, pendingRuns: 0, ftsOnlyRuns: 0, vecAvailable: true };
    let meetingIndexProgressState: {
      state: "idle" | "running" | "paused" | "complete" | "error";
      total: number;
      completed: number;
      currentRunFolder: string | null;
      errors: number;
      scope: "missing-chunks" | "missing-embeddings";
    } = {
      state: "idle",
      total: 0,
      completed: 0,
      currentRunFolder: null,
      errors: 0,
      scope: "missing-chunks",
    };

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
      if (run) {
        run.status = "processing";
        run.prompt_output_ids = promptIds;
      }
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

        const finishProcessing = () => {
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

        if (progressEmissionDelayMs > 0) {
          setTimeout(finishProcessing, progressEmissionDelayMs);
        } else {
          finishProcessing();
        }
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
      /**
       * Test helper: set the in-memory document content the mock returns
       * from `runs:read-document`. Used by the transcript-tab cache-
       * invalidation regression test to rewrite a document AFTER the
       * renderer has already cached it, simulating a pipeline that
       * just produced a new transcript.
       */
      setDocument(runFolder, fileName, content) {
        docs[runFolder] ??= {};
        docs[runFolder][fileName] = content;
        files[runFolder] ??= [];
        if (!files[runFolder].some((f) => f.name === fileName)) {
          files[runFolder].push({ name: fileName, size: content.length, kind: "document" });
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
      /**
       * Test helpers for the consent-first permissions spec. Spec asserts
       * that landing on step 4 of the wizard does NOT auto-fire either the
       * microphone request or the system-audio probe — both only run on
       * explicit button click.
       */
      setMicPermissionStatus(status) {
        micPermissionStatus = status;
      },
      getPermissionCallCounts() {
        return { ...permissionCallCounts };
      },
      resetPermissionCallCounts() {
        permissionCallCounts.getMicrophonePermission = 0;
        permissionCallCounts.requestMicrophonePermission = 0;
        permissionCallCounts.probeSystemAudioPermission = 0;
      },
      /**
       * Test helper: schedule the next call to `deps.install(target)` to
       * return a failure result instead of the happy `{ ok: true }`. The
       * override clears itself on first use so a subsequent retry hits
       * the normal success path. Used by installer-failure-modes spec
       * to drive checksum-mismatch / network-error / extract-failure
       * UX without standing up an actual download server.
       */
      setNextInstallFailure(target, response) {
        installFailureOverrides.set(target, clone(response));
      },
      /**
       * Test helper: schedule the next call to `setupAsr()` to return a
       * failure (with optional log lines emitted before the return).
       * One-shot, mirrors `setNextInstallFailure`. Used by Parakeet-chain
       * failure specs (ffmpeg auto-install fails, Python install fails,
       * etc.) to drive the renderer's `[<phase>]: ...` unhappy-path UX.
       */
      setNextSetupAsrFailure(failure) {
        mockSetupAsrFailure = clone(failure);
      },
      /**
       * Test helper: replace the mock's current updater status. Pushed
       * to subscribers so any rendered component (Settings panel,
       * UpdaterBanner) re-renders against the new state. Used by the
       * updater enabled-state spec to exercise available / downloading /
       * downloaded / deferred-recording / error UI.
       */
      setUpdaterStatus(next) {
        updaterStatusState = clone(next);
        emit("updaterStatus", clone(updaterStatusState));
      },
      /** Test helper: read the current updater prefs the mock persists. */
      getUpdaterPrefs() {
        return { ...updaterPrefsState };
      },
      getLastExternalAction() {
        return clone(externalActionLog[0] ?? null);
      },
      setProgressEmissionDelay(ms) {
        progressEmissionDelayMs = Math.max(0, Number(ms) || 0);
      },
      /**
       * Test helper: toggle the mock's embedding-model installed state.
       * Used by the embed-model wizard regression test to drive the
       * "row appears + Finish blocked + click installs + Finish enables"
       * flow without standing up an Ollama daemon.
       */
      setEmbedModelInstalled(installed) {
        embedModelInstalled = !!installed;
      },
      /**
       * Test helper: read the count of `installEmbedModel` IPC calls
       * since the harness was created. The "no surprise install" test
       * walks Finish with semantic search disabled and asserts this
       * stays 0 — i.e. neither the renderer nor any main-process
       * startup hook pulled the model implicitly.
       */
      getInstallEmbedModelCallCount() {
        return installEmbedModelCallCount;
      },
      /**
       * Test helper: synthesize a `pipelineProgress` event from the
       * outside. Used by the transcript-tab cache-invalidation
       * regression test to drive a `run-complete` event without going
       * through the full processRecording / startReprocess flow. The
       * mock's normal pipeline emissions go through this same listener
       * fan-out, so the renderer can't tell the difference.
       */
      emitPipelineProgress(event) {
        emit("pipelineProgress", clone(event));
      },
      /** Test helper: number of times config.initProject() has been called. */
      getInitProjectCallCount() {
        return initProjectCallCount;
      },
      /** Test helper: the request payload passed to the most recent config.initProject() call (or null). */
      getLastInitProjectRequest() {
        return clone(lastInitProjectRequest);
      },
      /**
       * Test helper: replace the meeting-index health snapshot the mock
       * returns from `meetingIndex.health()`. Pass a partial — fields
       * not provided keep their current value. Used by the
       * settings-meeting-index spec to drive each panel state.
       */
      setMeetingIndexHealth(partial) {
        meetingIndexHealthState = {
          ...meetingIndexHealthState,
          ...partial,
        };
      },
      /**
       * Test helper: emit a synthetic
       * `meetingIndexBackfillProgress` event. Lets the spec step the
       * panel through running → complete (with or without errors)
       * without standing up a real Ollama daemon. Also updates the
       * status the mock returns from `backfillStatus()` so a
       * mid-flight Settings re-mount sees the same value.
       */
      emitMeetingIndexProgress(next) {
        meetingIndexProgressState = {
          ...meetingIndexProgressState,
          ...next,
        };
        emit("meetingIndexBackfillProgress", clone(meetingIndexProgressState));
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
        async initProject(req) {
          initProjectCallCount += 1;
          lastInitProjectRequest = clone(req);
          // Mirror the request into the mock's stored config so a
          // subsequent config.get() returns what the wizard wrote.
          // Mock must mirror the real IPC handler's merge semantics —
          // see ipc.ts config:init handler — otherwise tests catch mock
          // bugs instead of production regressions.
          config.data_path = req.data_path;
          config.obsidian_integration = clone(req.obsidian_integration);
          config.asr_provider = req.asr_provider;
          if (req.llm_provider) config.llm_provider = req.llm_provider;
          if (req.ollama_model) config.ollama.model = req.ollama_model;
          // Empty mic_device means "wizard didn't change it" — preserve
          // existing on rerun, only auto-fill on first run. Mirrors
          // ipc.ts:config:init.
          if (req.recording.mic_device) {
            config.recording.mic_device = req.recording.mic_device;
          }
          config.recording.system_device = req.recording.system_device;
          config.audio_retention_days = req.audio_retention_days;
          if (req.audio_storage_mode)
            config.audio_storage_mode = req.audio_storage_mode;
          persistState();
        },
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
            folder_size_bytes: existingRun?.folder_size_bytes ?? 5_500_000,
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
          return [{ name: "Built-in Mic" }, { name: "MacBook Pro Microphone" }];
        },
        async startAudioMonitor() {
          // no-op in tests; real audio capture isn't available in Playwright
          return [{ name: "Built-in Mic" }, { name: "MacBook Pro Microphone" }];
        },
        async stopAudioMonitor() {
          // no-op in tests
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
          const key = `${runFolder}|${fileName}`;
          const counts = (window as any).__ipcCallCounts ??= { readDocument: {} as Record<string, number> };
          counts.readDocument[key] = (counts.readDocument[key] ?? 0) + 1;
          const content = docs[runFolder]?.[fileName];
          if (content == null) {
            throw new Error(`ENOENT: no such file or directory, open '${runFolder}/${fileName}'`);
          }
          return content;
        },
        async getMediaSource(runFolder, fileName) {
          ensureRunAvailable(runFolder, { prune: true });
          // Return a tiny valid WAV as a blob: URL so <audio> elements can
          // actually load and play in Playwright tests.
          const wavBytes = generateTinyWavBytes();
          const blob = new Blob([wavBytes], { type: "audio/wav" });
          return URL.createObjectURL(blob);
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
              const finishSuccess = () => {
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
                persistState();
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
              };
              if (progressEmissionDelayMs > 0) {
                const progressCounts = [3, 8, 14];
                const charCounts = [40, 180, 420];
                let step = 0;
                const tick = () => {
                  if (step < progressCounts.length) {
                    emit("pipelineProgress", {
                      type: "output-progress",
                      runFolder: req.runFolder,
                      promptOutputId: selectedPrompt.id,
                      tokensGenerated: progressCounts[step],
                      charsGenerated: charCounts[step],
                    });
                    step++;
                    setTimeout(tick, progressEmissionDelayMs);
                  } else {
                    finishSuccess();
                  }
                };
                setTimeout(tick, progressEmissionDelayMs);
              } else {
                finishSuccess();
              }
              return;
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
            folder_size_bytes: 11_400_128,
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
            folder_size_bytes: 0,
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
            temperature: null,
            source_path: `/Users/test/.gistlist/prompts/${id}.md`,
            body,
          });
          persistPromptState();
        },
        async delete(id) {
          const idx = prompts.findIndex((item) => item.id === id);
          if (idx === -1) throw new Error(`Prompt not found: ${id}`);
          if (prompts[idx].builtin) {
            throw new Error(`Cannot delete built-in prompt "${id}".`);
          }
          prompts.splice(idx, 1);
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
          return "/Users/test/.gistlist/prompts";
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
      cancelSetupAsr() {
        // Mock no-op: real impl sends "setup-asr:abort" IPC; tests
        // that exercise cancellation can poke a hook here when needed.
      },
      async setupAsr() {
        // Mock implementation of the new chain: emit log lines for each
        // sub-step and report success. Real spec failure-mode tests
        // override this via __MEETING_NOTES_TEST.setNextSetupAsrFailure()
        // to drive the {ok, error, failedPhase} unhappy paths.
        if (mockSetupAsrFailure) {
          const failure = mockSetupAsrFailure;
          mockSetupAsrFailure = null;
          for (const line of failure.logLines ?? []) {
            emit("setupAsrLog", line);
          }
          return {
            ok: false,
            error: failure.error,
            failedPhase: failure.failedPhase,
          };
        }
        // Mirror the production setup-asr log stream so the wizard's
        // 4-step rail and activity stream get exercised end-to-end:
        //   - The three IPC-emitted `→ ensuring …` / `→ building …`
        //     boundaries for audio-tools, python-runtime, venv.
        //   - The `→ Downloading Parakeet weights` boundary that the
        //     real ipc.ts synthesizes when the engine logs
        //     "Running smoke test (downloads Parakeet weights …)".
        //     Without this, mock e2e never proves the rail reaches
        //     the speech-model phase.
        //   - The engine's "Running smoke test (downloads Parakeet
        //     weights …)" raw line so the activity stream surfaces it
        //     too (production users see this text under "View raw log").
        //   - The engine's `✓ Smoke test transcription: …` success
        //     marker, which is the activity-stream signal that
        //     verification happened.
        emit("setupAsrLog", "→ ensuring ffmpeg + ffprobe");
        emit("setupAsrLog", "  ✓ ffmpeg + ffprobe already present");
        emit("setupAsrLog", "→ ensuring app-managed Python runtime");
        emit("setupAsrLog", "  ✓ Python runtime already present");
        emit("setupAsrLog", "→ building venv and installing mlx-audio");
        emit("setupAsrLog", "  Creating venv: ~/.gistlist/parakeet-venv");
        emit("setupAsrLog", "  ✓ Installed: ~/.gistlist/parakeet-venv/bin/mlx_audio.stt.generate");
        emit("setupAsrLog", "→ Downloading Parakeet weights");
        emit("setupAsrLog", "  Running smoke test (downloads Parakeet weights on first run, ~600 MB)…");
        emit("setupAsrLog", '  ✓ Smoke test transcription: "Parakeet smoke test is working."');
        deps.parakeet = { path: "/mock/parakeet-venv/bin/mlx_audio.stt.generate" };
        return { ok: true };
      },
      llm: {
        async check() {
          return {
            daemon: true,
            source: "bundled-spawned",
            installedModels: clone(installedLocalModels),
            verified: "verified" as const,
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
            source: "system-running",
            models: [
              {
                model: "qwen3.5:9b",
                name: "qwen3.5:9b",
                size: 5400000000,
                size_vram: 4100000000,
                expires_at: new Date(Date.now() + 14 * 60 * 1000).toISOString(),
                details: {
                  parameter_size: "9B",
                  quantization_level: "Q4_K_M",
                  family: "qwen",
                  format: "gguf",
                },
              },
            ],
            systemMemory: {
              totalBytes: 32 * 1024 ** 3,
              freeBytes: 18 * 1024 ** 3,
              ollamaVramBytes: 4100000000,
            },
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
        async openAudioPermissionPane() {
          // no-op in tests
        },
        async openMicrophonePermissionPane() {
          // no-op in tests
        },
        async getAppIdentity() {
          return {
            displayName: "Gistlist",
            tccBundleName: "Gistlist",
            bundlePath: "/Applications/Gistlist.app",
            isDev: false,
            isPackaged: true,
          };
        },
        async revealAppBundle() {
          // no-op in tests
        },
        async requestMicrophonePermission() {
          permissionCallCounts.requestMicrophonePermission += 1;
          micPermissionStatus = "granted";
          return { granted: true, status: "granted" };
        },
        async getMicrophonePermission() {
          permissionCallCounts.getMicrophonePermission += 1;
          return { status: micPermissionStatus };
        },
        async probeSystemAudioPermission() {
          permissionCallCounts.probeSystemAudioPermission += 1;
          return {
            status: "granted" as const,
            totalSamples: 16000,
            zeroSamples: 0,
            totalBytes: 32000,
          };
        },
        async getAudioPermissions() {
          return {
            microphone: micPermissionStatus,
            systemAudio: "granted" as const,
          };
        },
        async capabilities() {
          return { systemAudioSupported: true };
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
          return "/Users/test/.gistlist/app.log";
        },
        async listAppEntries() {
          return clone(appLogEntries);
        },
        async listProcesses() {
          return clone(processes);
        },
        async revealApp() {
          recordExternalAction("reveal-app-log");
        },
        async revealOllama() {
          recordExternalAction("reveal-ollama-log");
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
        // Wrap flat depsState fields into the ResolvedTool shape the
        // renderer now expects (path / source / version / verified).
        // Default `verified` mirrors prod logic: "verified" for app/bundled
        // sources, "system-unverified" for system-PATH (since Phase 2 no
        // longer spawns system binaries to confirm), "missing" for null
        // path. Specs that need to override per-row can do so by composing
        // their own depsCheck stub.
        const verifiedFor = (
          path: string | null,
          source: "system" | "app-installed" | "bundled"
        ): "verified" | "system-unverified" | "missing" => {
          if (!path) return "missing";
          if (source === "app-installed" || source === "bundled") return "verified";
          return "system-unverified";
        };
        const wrap = (
          path: string | null,
          source: "system" | "app-installed" | "bundled",
          version: string | null = null
        ) => ({
          path,
          source: path ? source : null,
          version,
          verified: verifiedFor(path, source),
        });
        return {
          ffmpeg: wrap(depsState.ffmpeg, "system", depsState.ffmpegVersion),
          ffprobe: wrap(depsState.ffprobe, "system", depsState.ffprobeVersion),
          blackhole: depsState.blackhole,
          systemAudioSupported: depsState.systemAudioSupported,
          python: wrap(depsState.python, "system", depsState.pythonVersion),
          parakeet: wrap(depsState.parakeet, "app-installed"),
          whisper: wrap(depsState.whisper ?? null, "system"),
          ollama: {
            daemon: depsState.ollama !== null,
            source:
              depsState.ollama !== null
                ? ("bundled-spawned" as const)
                : undefined,
            installedModels:
              depsState.ollama !== null ? clone(installedLocalModels) : [],
            version:
              depsState.ollama !== null ? depsState.ollamaVersion : null,
            verified:
              depsState.ollama !== null
                ? ("verified" as const)
                : ("missing" as const),
          },
        };
      },
      deps: {
        async install(target) {
          // Test seam: if a spec primed an install-failure for this
          // target via setNextInstallFailure, return that exact failure
          // (and clear it so a follow-up Retry hits the happy path).
          // This is how installer-failure-modes specs drive the
          // checksum-mismatch / verify-exec UX without standing up an
          // actual fixture download server.
          if (installFailureOverrides.has(target)) {
            const override = installFailureOverrides.get(target)!;
            installFailureOverrides.delete(target);
            const phase = override.failedPhase
              ? ` [${override.failedPhase}]`
              : "";
            emit(
              "depsInstallLog",
              `✘ ${target} install failed${phase}: ${override.error ?? "unknown"}`
            );
            return override;
          }
          // The DepsInstallTarget union changed in Phase 2 from
          // "ffmpeg" | "whisper-cpp" to "ffmpeg" | "ollama" | "whisper-cli".
          // Mock paths still use Homebrew-style locations because that's
          // what the test fixtures already have on disk, but the wizard
          // surfaces these as `(system)` source — same as a real machine
          // with Homebrew already installed.
          emit("depsInstallLog", `Installed ${target}`);
          if (target === "ffmpeg") depsState.ffmpeg = "/opt/homebrew/bin/ffmpeg";
          if (target === "whisper-cli") depsState.whisper = "/opt/homebrew/bin/whisper-cli";
          if (target === "ollama") {
            // Flip the daemon state on so the post-install depsCheck
            // reports installed. Tests that simulate "Ollama installed
            // but daemon failed to start" leave depsState.ollama as null
            // and override api.llm.check to return daemon: false.
            depsState.ollama = "/opt/homebrew/bin/ollama";
          }
          persistState();
          return { ok: true };
        },
        async checkBrew() {
          return depsState.brewAvailable;
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
      integrations: (() => {
        // Keep a tiny piece of mock state so install/uninstall roundtrip and
        // the UI can reflect the change without rebuilding the app.
        let configInstalled = false;
        return {
          async getMcpStatus() {
            return {
              serverJsPath: "/mock/Gistlist.app/Contents/Resources/mcp-server/server.js",
              serverJsExists: true,
              configInstalled,
              configReadError: null,
              claudeConfigPath:
                "/mock/Library/Application Support/Claude/claude_desktop_config.json",
              claudeDesktopInstalled: "yes",
              meetingsIndexed: 7,
              ollamaRunning: true,
            };
          },
          async installMcpForClaude() {
            recordExternalAction("install-mcp-claude", {});
            // Test-hook: when a spec sets __MOCK_INSTALL_MCP_FAIL__ via
            // page.addInitScript, return the shape main/integrations.ts
            // produces on a JSON-parse or write failure. Lets the spec
            // exercise the error-toast branch without rebuilding the app.
            if ((window as any).__MOCK_INSTALL_MCP_FAIL__) {
              return {
                ok: false,
                error:
                  "Claude Desktop config at /mock/path is not valid JSON. Fix or delete it and try again.",
              };
            }
            const updated = configInstalled;
            configInstalled = true;
            return { ok: true, updated, legacyRemoved: false };
          },
          async uninstallMcpForClaude() {
            recordExternalAction("uninstall-mcp-claude", {});
            const updated = configInstalled;
            configInstalled = false;
            return { ok: true, updated, legacyRemoved: false };
          },
        };
      })(),
      deepLink: {
        // No-op in the mocked browser environment — there's no main process
        // to signal. Exposed so the renderer's `api.deepLink.ready()` call
        // on App mount doesn't throw.
        ready: () => {},
      },
      support: {
        // Mocked out: no real mailto / Finder in browser-backed Playwright.
        // Specs that care assert against the externalActionLog instead of
        // expecting a window to open.
        async openFeedbackMail() {
          externalActionLog.push({ type: "support:open-feedback-mail" });
        },
        async revealLogsInFinder() {
          externalActionLog.push({ type: "support:reveal-logs" });
        },
        async openLicensesFile() {
          externalActionLog.push({ type: "support:open-licenses" });
        },
      },
      updater: {
        // Updater is build-time gated. The mock starts in the disabled
        // shape (matches first-beta behavior). Specs that want to drive
        // the enabled UI flip the state via
        // __MEETING_NOTES_TEST.setUpdaterStatus({...}). Each method below
        // mutates updaterStatusState and re-broadcasts via the
        // updaterStatus subscription so subscribed components re-render.
        async getStatus() {
          return clone(updaterStatusState);
        },
        async check() {
          if (!updaterStatusState.enabled) return clone(updaterStatusState);
          updaterStatusState = {
            ...updaterStatusState,
            kind: "checking",
            lastChecked: new Date().toISOString(),
          };
          emit("updaterStatus", clone(updaterStatusState));
          // Synchronously settle into the prior available/no-update kind
          // — specs that want a specific resolution call setUpdaterStatus
          // directly. Default to "no-update" if nothing announced.
          updaterStatusState = {
            ...updaterStatusState,
            kind: updaterStatusState.version ? "available" : "no-update",
          };
          emit("updaterStatus", clone(updaterStatusState));
          return clone(updaterStatusState);
        },
        async download() {
          if (!updaterStatusState.enabled) return clone(updaterStatusState);
          // Synchronous transition straight to "downloaded" — specs
          // assert the result, not the streaming animation. Specs that
          // want to test "downloading" mid-state set it explicitly.
          updaterStatusState = {
            ...updaterStatusState,
            kind: "downloaded",
            bytesDone: updaterStatusState.bytesTotal ?? undefined,
          };
          emit("updaterStatus", clone(updaterStatusState));
          return clone(updaterStatusState);
        },
        async install() {
          // Mirror the production dev simulator: never actually call
          // quitAndInstall in tests. State stays at "downloaded".
          if (!updaterStatusState.enabled) return clone(updaterStatusState);
          externalActionLog.push({ type: "updater:install-attempted" });
          return clone(updaterStatusState);
        },
        async getPrefs() {
          return { ...updaterPrefsState };
        },
        async setPrefs(prefs) {
          Object.assign(updaterPrefsState, prefs);
          // Nudge subscribers so any component holding a stale prefs
          // copy (e.g., the global UpdaterBanner) refetches and re-
          // renders. Cheap — payload is the unchanged status.
          emit("updaterStatus", clone(updaterStatusState));
          return { ...updaterPrefsState };
        },
        async simulate() {
          return clone(updaterStatusState);
        },
      },
      meetingIndex: {
        async backfillStart(arg) {
          const scope = arg?.scope ?? "missing-chunks";
          meetingIndexProgressState = {
            ...meetingIndexProgressState,
            state: "complete",
            scope,
          };
          return clone(meetingIndexProgressState);
        },
        async backfillStatus() {
          return clone(meetingIndexProgressState);
        },
        async backfillCountPending() {
          return meetingIndexHealthState.pendingRuns;
        },
        async health() {
          return clone(meetingIndexHealthState);
        },
        async embedModelStatus() {
          return { model: "nomic-embed-text", installed: embedModelInstalled };
        },
        async installEmbedModel() {
          installEmbedModelCallCount += 1;
          embedModelInstalled = true;
          persistState();
          return;
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
        audioMonitorLevels(cb) {
          return subscribe("audioMonitorLevels", cb);
        },
        meetingIndexBackfillProgress(cb) {
          return subscribe("meetingIndexBackfillProgress", cb);
        },
        installerProgress(cb) {
          return subscribe("installerProgress", cb);
        },
        updaterStatus(cb) {
          return subscribe("updaterStatus", cb);
        },
      },
    };
  });
}
