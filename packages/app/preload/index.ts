import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  MeetingNotesApi,
  AppConfigDTO,
  AppActionEvent,
  AppLogEntry,
  AppLogQuery,
  ActivityProcess,
  InitConfigRequest,
  ProcessRecordingRequest,
  StartRecordingRequest,
  StopRecordingRequest,
  StartRecordingForDraftRequest,
  ContinueRecordingRequest,
  CreateDraftRequest,
  UpdatePrepRequest,
  ReprocessRequest,
  BulkReprocessRequest,
  PromptRow,
  RecordingStatus,
  PipelineProgressEvent,
  JobSummary,
  LaunchChatRequest,
} from "../shared/ipc.js";

const api: MeetingNotesApi = {
  config: {
    get: () => ipcRenderer.invoke("config:get"),
    save: (config: AppConfigDTO) => ipcRenderer.invoke("config:save", config),
    initProject: (req: InitConfigRequest) => ipcRenderer.invoke("config:init", req),
    setDataPath: (newPath) => ipcRenderer.invoke("config:set-data-path", newPath),
    setObsidianEnabled: (enabled) =>
      ipcRenderer.invoke("config:set-obsidian-enabled", enabled),
    setObsidianVault: (vaultPath) =>
      ipcRenderer.invoke("config:set-obsidian-vault", vaultPath),
    openDataDirectory: () => ipcRenderer.invoke("config:open-data-directory"),
    pickDirectory: (opts) => ipcRenderer.invoke("config:pick-directory", opts),
    pickMediaFile: () => ipcRenderer.invoke("config:pick-media-file"),
  },
  recording: {
    getStatus: () => ipcRenderer.invoke("recording:get-status"),
    start: (req: StartRecordingRequest) => ipcRenderer.invoke("recording:start", req),
    stop: (req?: StopRecordingRequest) => ipcRenderer.invoke("recording:stop", req),
    startForDraft: (req: StartRecordingForDraftRequest) =>
      ipcRenderer.invoke("recording:start-for-draft", req),
    pause: () => ipcRenderer.invoke("recording:pause"),
    resume: () => ipcRenderer.invoke("recording:resume"),
    continueRecording: (req: ContinueRecordingRequest) =>
      ipcRenderer.invoke("recording:continue", req),
    listAudioDevices: () => ipcRenderer.invoke("recording:list-audio-devices"),
  },
  runs: {
    list: () => ipcRenderer.invoke("runs:list"),
    get: (runFolder) => ipcRenderer.invoke("runs:get", runFolder),
    readDocument: (runFolder, fileName) =>
      ipcRenderer.invoke("runs:read-document", runFolder, fileName),
    getMediaSource: (runFolder, fileName) =>
      ipcRenderer.invoke("runs:get-media-source", runFolder, fileName),
    downloadMedia: (runFolder, fileName) =>
      ipcRenderer.invoke("runs:download-media", runFolder, fileName),
    deleteMedia: (runFolder, fileName) =>
      ipcRenderer.invoke("runs:delete-media", runFolder, fileName),
    writeNotes: (runFolder, content) =>
      ipcRenderer.invoke("runs:write-notes", runFolder, content),
    startProcessRecording: (req: ProcessRecordingRequest) =>
      ipcRenderer.invoke("runs:start-process-recording", req),
    processRecording: (req: ProcessRecordingRequest) =>
      ipcRenderer.invoke("runs:process-recording", req),
    startReprocess: (req: ReprocessRequest) =>
      ipcRenderer.invoke("runs:start-reprocess", req),
    reprocess: (req: ReprocessRequest) => ipcRenderer.invoke("runs:reprocess", req),
    bulkReprocess: (req: BulkReprocessRequest) =>
      ipcRenderer.invoke("runs:bulk-reprocess", req),
    processMedia: (mediaToken, title) =>
      ipcRenderer.invoke("runs:process-media", mediaToken, title),
    processDroppedMedia: (file, title) => {
      const mediaPath = webUtils.getPathForFile(file as any);
      if (!mediaPath) {
        throw new Error("Could not read the dropped file.");
      }
      return ipcRenderer.invoke("runs:process-dropped-media", mediaPath, title);
    },
    openInObsidian: (runFolder, fileName) =>
      ipcRenderer.invoke("runs:open-in-obsidian", runFolder, fileName),
    openInFinder: (runFolder) => ipcRenderer.invoke("runs:open-in-finder", runFolder),
    deleteRun: (runFolder) => ipcRenderer.invoke("runs:delete", runFolder),
    updateMeta: (req) => ipcRenderer.invoke("runs:update-meta", req),
    createDraft: (req: CreateDraftRequest) => ipcRenderer.invoke("runs:create-draft", req),
    writePrep: (runFolder: string, content: string) =>
      ipcRenderer.invoke("runs:write-prep", runFolder, content),
    readPrep: (runFolder: string) => ipcRenderer.invoke("runs:read-prep", runFolder),
    addAttachment: (runFolder: string) =>
      ipcRenderer.invoke("runs:add-attachment", runFolder),
    removeAttachment: (runFolder: string, fileName: string) =>
      ipcRenderer.invoke("runs:remove-attachment", runFolder, fileName),
    listAttachments: (runFolder: string) =>
      ipcRenderer.invoke("runs:list-attachments", runFolder),
    updatePrep: (req: UpdatePrepRequest) => ipcRenderer.invoke("runs:update-prep", req),
    reopenAsDraft: (runFolder: string) => ipcRenderer.invoke("runs:reopen-as-draft", runFolder),
  },
  prompts: {
    list: () => ipcRenderer.invoke("prompts:list"),
    save: (id: string, body: string, patch: Partial<PromptRow>) =>
      ipcRenderer.invoke("prompts:save", id, body, patch),
    create: (id, label, filename, body) =>
      ipcRenderer.invoke("prompts:create", id, label, filename, body),
    enable: (id, enabled) => ipcRenderer.invoke("prompts:enable", id, enabled),
    setAuto: (id, auto) => ipcRenderer.invoke("prompts:set-auto", id, auto),
    resetToDefault: (id) => ipcRenderer.invoke("prompts:reset-to-default", id),
    getDir: () => ipcRenderer.invoke("prompts:get-dir"),
    openInFinder: (promptId?: string) => ipcRenderer.invoke("prompts:open-in-finder", promptId),
  },
  secrets: {
    has: (name) => ipcRenderer.invoke("secrets:has", name),
    set: (name, value) => ipcRenderer.invoke("secrets:set", name, value),
  },
  setupAsr: (opts) => ipcRenderer.invoke("setup-asr", opts),
  llm: {
    check: () => ipcRenderer.invoke("llm:check"),
    setup: (opts) => ipcRenderer.invoke("llm:setup", opts),
    listInstalled: () => ipcRenderer.invoke("llm:list-installed"),
    remove: (model) => ipcRenderer.invoke("llm:remove", model),
    runtime: () => ipcRenderer.invoke("llm:runtime"),
  },
  jobs: {
    list: () => ipcRenderer.invoke("jobs:list"),
    cancel: (jobId) => ipcRenderer.invoke("jobs:cancel", jobId),
    tailLog: (jobId, lines) => ipcRenderer.invoke("jobs:tail-log", jobId, lines),
  },
  system: {
    detectHardware: () => ipcRenderer.invoke("system:detect-hardware"),
  },
  logs: {
    tailApp: (lines) => ipcRenderer.invoke("logs:tail-app", lines),
    tailRun: (runFolder, lines) =>
      ipcRenderer.invoke("logs:tail-run", runFolder, lines),
    appPath: () => ipcRenderer.invoke("logs:app-path"),
    listAppEntries: (query?: AppLogQuery) =>
      ipcRenderer.invoke("logs:list-app-entries", query),
    listProcesses: () => ipcRenderer.invoke("logs:list-processes"),
    reportRendererError: (payload) =>
      ipcRenderer.invoke("logs:renderer-error", payload),
  },
  depsCheck: () => ipcRenderer.invoke("deps:check"),
  deps: {
    install: (target) => ipcRenderer.invoke("deps:install", target),
    checkBrew: () => ipcRenderer.invoke("deps:check-brew"),
    restartAudio: () => ipcRenderer.invoke("deps:restart-audio"),
  },
  obsidian: {
    detectVaults: () => ipcRenderer.invoke("obsidian:detect-vaults"),
  },
  chatLauncher: {
    detectApps: () => ipcRenderer.invoke("chatLauncher:detect-apps"),
    launch: (req: LaunchChatRequest) => ipcRenderer.invoke("chatLauncher:launch", req),
  },
  on: {
    recordingStatus: (cb: (s: RecordingStatus) => void) => {
      const handler = (_e: unknown, status: RecordingStatus) => cb(status);
      ipcRenderer.on("recording:status", handler);
      return () => ipcRenderer.removeListener("recording:status", handler);
    },
    pipelineProgress: (cb: (e: PipelineProgressEvent) => void) => {
      const handler = (_e: unknown, ev: PipelineProgressEvent) => cb(ev);
      ipcRenderer.on("pipeline:progress", handler);
      return () => ipcRenderer.removeListener("pipeline:progress", handler);
    },
    setupAsrLog: (cb: (line: string) => void) => {
      const handler = (_e: unknown, line: string) => cb(line);
      ipcRenderer.on("setup-asr:log", handler);
      return () => ipcRenderer.removeListener("setup-asr:log", handler);
    },
    setupLlmLog: (cb: (line: string) => void) => {
      const handler = (_e: unknown, line: string) => cb(line);
      ipcRenderer.on("setup-llm:log", handler);
      return () => ipcRenderer.removeListener("setup-llm:log", handler);
    },
    depsInstallLog: (cb: (line: string) => void) => {
      const handler = (_e: unknown, line: string) => cb(line);
      ipcRenderer.on("deps-install:log", handler);
      return () => ipcRenderer.removeListener("deps-install:log", handler);
    },
    appAction: (cb: (event: AppActionEvent) => void) => {
      const handler = (_e: unknown, event: AppActionEvent) => cb(event);
      ipcRenderer.on("app:action", handler);
      return () => {
        ipcRenderer.removeListener("app:action", handler);
      };
    },
    jobUpdate: (cb: (job: JobSummary) => void) => {
      const handler = (_e: unknown, job: JobSummary) => cb(job);
      ipcRenderer.on("jobs:update", handler);
      return () => ipcRenderer.removeListener("jobs:update", handler);
    },
    logEntry: (cb: (entry: AppLogEntry) => void) => {
      const handler = (_e: unknown, entry: AppLogEntry) => cb(entry);
      ipcRenderer.on("logs:entry", handler);
      return () => ipcRenderer.removeListener("logs:entry", handler);
    },
    processUpdate: (cb: (process: ActivityProcess) => void) => {
      const handler = (_e: unknown, process: ActivityProcess) => cb(process);
      ipcRenderer.on("logs:process-update", handler);
      return () => ipcRenderer.removeListener("logs:process-update", handler);
    },
  },
};

contextBridge.exposeInMainWorld("api", api);
