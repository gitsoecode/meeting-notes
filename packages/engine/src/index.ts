// Public API for @gistlist/engine
// Everything needed by the CLI and Electron app flows through here.

export {
  loadConfig,
  saveConfig,
  invalidateConfigCache,
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
  createDraftRun,
  formatAudioSegmentName,
  migrateFlatLayoutToSegment,
  updateRunStatus,
  updatePromptOutput,
  loadRunManifest,
  type RunManifest,
  type RunStatus,
  type PromptOutputState,
  type PromptOutputStatus,
  manifestToFrontmatter,
  buildIndexBody,
  type CreateRunOptions,
  type CreateDraftOptions,
} from "./core/run.js";

export { type RunStore } from "./core/run-store.js";
export { FilesystemRunStore, walkRunFolders } from "./core/filesystem-run-store.js";

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

export {
  isAllowedPromptOutputFilename,
  RESERVED_PROMPT_OUTPUT_FILENAMES,
} from "./core/prompt-validation.js";

export {
  getAudioInfo,
  mediaHasAudioStream,
  checkAudioSilence,
  mergeAudioFiles,
  encodeAudioArchive,
  decodeAudioToWav,
  type AudioArchiveFormat,
  type SilenceCheckResult,
} from "./core/audio.js";
export { testAudioCapture, type AudioTestReport, type DeviceTestResult } from "./core/audio-test.js";

export {
  buildMarkdown,
  writeMarkdownFile,
  writeRawFile,
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
export { unloadOllamaModels, type PullProgress } from "./adapters/llm/ollama.js";

export { moveDataDirectory } from "./core/data-path.js";

export { migrateVaultPromptsToHome } from "./core/migrate-prompts.js";

export { FfmpegRecorder, pickPhysicalMic } from "./adapters/recording/ffmpeg.js";
export { startAudioTeeCapture, recoverRawFile, type AudioTeeSession } from "./adapters/recording/audiotee-recorder.js";
export type {
  Recorder,
  RecorderOptions,
  RecordingSession,
  RecordingStopResult,
} from "./adapters/recording/recorder.js";

export { ClaudeProvider } from "./adapters/llm/claude.js";
export { OpenAIProvider } from "./adapters/llm/openai.js";
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

// ---- Chat index (retrieval assistant) ----
export { chunkTranscript, chunkMarkdown } from "./core/chat-index/chunk.js";
export { embedViaOllama, createOllamaEmbedder, DEFAULT_EMBEDDING_MODEL } from "./core/chat-index/embed.js";
export { parseTranscriptMarkdown } from "./core/chat-index/parse-transcript-md.js";
export {
  searchMeetings,
  getMeetingSummaryByRunId,
  getTranscriptWindow,
  listMeetings,
  type SearchOptions,
  type MeetingSummary,
  type TranscriptWindow,
  type MeetingListRow,
} from "./core/chat-index/retrieve.js";
export type {
  ChunkInput,
  ChunkKind,
  CitationSource,
  SearchResult,
  SearchFilters,
  StoredCitation,
  ChatThread,
  ChatMessage,
  RunStatus as ChatRunStatus,
} from "./core/chat-index/types.js";
