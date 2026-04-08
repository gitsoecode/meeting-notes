import { contextBridge, ipcRenderer } from "electron";
import type {
  MeetingNotesApi,
  AppConfigDTO,
  InitConfigRequest,
  StartRecordingRequest,
  ReprocessRequest,
  BulkReprocessRequest,
  PromptRow,
  RecordingStatus,
  PipelineProgressEvent,
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
    openInFinder: (p) => ipcRenderer.invoke("config:open-in-finder", p),
    pickDirectory: (opts) => ipcRenderer.invoke("config:pick-directory", opts),
    pickAudioFile: () => ipcRenderer.invoke("config:pick-audio-file"),
  },
  recording: {
    getStatus: () => ipcRenderer.invoke("recording:get-status"),
    start: (req: StartRecordingRequest) => ipcRenderer.invoke("recording:start", req),
    stop: () => ipcRenderer.invoke("recording:stop"),
    listAudioDevices: () => ipcRenderer.invoke("recording:list-audio-devices"),
  },
  runs: {
    list: () => ipcRenderer.invoke("runs:list"),
    get: (runFolder) => ipcRenderer.invoke("runs:get", runFolder),
    readFile: (filePath) => ipcRenderer.invoke("runs:read-file", filePath),
    writeFile: (filePath, content) =>
      ipcRenderer.invoke("runs:write-file", filePath, content),
    reprocess: (req: ReprocessRequest) => ipcRenderer.invoke("runs:reprocess", req),
    bulkReprocess: (req: BulkReprocessRequest) =>
      ipcRenderer.invoke("runs:bulk-reprocess", req),
    processAudio: (audioPath, title) =>
      ipcRenderer.invoke("runs:process-audio", audioPath, title),
    openInObsidian: (filePath) => ipcRenderer.invoke("runs:open-in-obsidian", filePath),
    openInFinder: (runFolder) => ipcRenderer.invoke("runs:open-in-finder", runFolder),
    deleteRun: (runFolder) => ipcRenderer.invoke("runs:delete", runFolder),
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
    openInFinder: () => ipcRenderer.invoke("prompts:open-in-finder"),
  },
  secrets: {
    has: (name) => ipcRenderer.invoke("secrets:has", name),
    set: (name, value) => ipcRenderer.invoke("secrets:set", name, value),
  },
  setupAsr: (opts) => ipcRenderer.invoke("setup-asr", opts),
  logs: {
    tailApp: (lines) => ipcRenderer.invoke("logs:tail-app", lines),
    tailRun: (runFolder, lines) =>
      ipcRenderer.invoke("logs:tail-run", runFolder, lines),
    appPath: () => ipcRenderer.invoke("logs:app-path"),
  },
  depsCheck: () => ipcRenderer.invoke("deps:check"),
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
    shortcutTriggered: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on("shortcut:toggle-recording", handler);
      ipcRenderer.on("tray:toggle-recording", handler);
      return () => {
        ipcRenderer.removeListener("shortcut:toggle-recording", handler);
        ipcRenderer.removeListener("tray:toggle-recording", handler);
      };
    },
  },
};

contextBridge.exposeInMainWorld("api", api);
