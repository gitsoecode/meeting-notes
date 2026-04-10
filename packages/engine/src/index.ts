// Public API for @meeting-notes/engine
// Everything needed by the CLI and Electron app flows through here.

export {
  loadConfig,
  saveConfig,
  getConfigDir,
  getConfigPath,
  getAppLogPath,
  resolveBasePath,
  resolveRunsPath,
  DEFAULT_CONFIG,
  type AppConfig,
  type ObsidianIntegrationConfig,
  type OllamaConfig,
} from "./core/config.js";

export {
  getSecret,
  setSecret,
  deleteSecret,
  hasSecret,
  requireSecret,
  SECRET_LABELS,
  type SecretName,
} from "./core/secrets.js";

export { initProject, bootstrapVault } from "./core/init.js";

export {
  createRun,
  updateRunStatus,
  updateSectionState,
  loadRunManifest,
  manifestToFrontmatter,
  type RunManifest,
  type SectionState,
  type CreateRunOptions,
} from "./core/run.js";

export { processRun } from "./core/process-run.js";

export {
  runPipeline,
  planPipelineSteps,
  loadAllPrompts,
  updatePromptFrontmatter,
  resetDefaultPrompts,
  getPromptsDir,
  seedAllDefaultPrompts,
  seedDefaultPrompt,
  DEFAULT_PROMPTS_DIR,
  type ResolvedPrompt,
  type PipelineInput,
  type PipelineResult,
  type PipelineRunOptions,
  type LlmCallFn,
  type PipelineProgressEvent,
  type PipelinePlannedStep,
} from "./core/pipeline.js";

export { getAudioInfo, mediaHasAudioStream } from "./core/audio.js";

export {
  buildMarkdown,
  writeMarkdownFile,
  writeRawFile,
  type Frontmatter,
} from "./core/markdown.js";

export {
  saveActiveRecording,
  loadActiveRecording,
  clearActiveRecording,
  isProcessAlive,
  stopRecordingProcesses,
  type ActiveRecording,
} from "./core/recording-state.js";

export { openInObsidian } from "./core/obsidian.js";

export { setupAsr } from "./core/setup-asr.js";

export { setupLlm, checkOllama, normalizeLocalModelId, type SetupLlmOptions } from "./core/setup-llm.js";

export { moveDataDirectory } from "./core/data-path.js";

export { migrateVaultPromptsToHome } from "./core/migrate-prompts.js";

export { FfmpegRecorder } from "./adapters/recording/ffmpeg.js";
export type {
  Recorder,
  RecorderOptions,
  RecordingSession,
  RecordingStopResult,
} from "./adapters/recording/recorder.js";

export { ClaudeProvider } from "./adapters/llm/claude.js";
export {
  OllamaProvider,
  pingOllama,
  listOllamaModels,
  listRunningOllamaModels,
  pullOllamaModel,
  deleteOllamaModel,
  type OllamaTag,
  type RunningOllamaModel,
} from "./adapters/llm/ollama.js";
export { classifyModel, type LlmKind } from "./adapters/llm/resolve.js";
export type { LlmProvider, LlmResponse } from "./adapters/llm/provider.js";
export { OperationAbortedError, throwIfAborted } from "./core/abort.js";

export {
  createAppLogger,
  createRunLogger,
  setAppLoggerListener,
  type Logger,
  type StructuredLogEntry,
} from "./logging/logger.js";
