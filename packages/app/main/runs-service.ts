import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import {
  loadConfig,
  loadRunManifest,
  updateRunStatus,
  loadAllPrompts,
  planPipelineSteps,
  processRun,
  runPipeline,
  getSecret,
  ClaudeProvider,
  OpenAIProvider,
  OllamaProvider,
  unloadOllamaModels,
  classifyModel,
  createRunLogger,
  createAppLogger,
  type LlmCallFn,
  type LlmProvider,
  type PipelineProgressEvent,
} from "@meeting-notes/engine";
import type {
  BulkReprocessRequest,
  BulkReprocessResult,
  ProcessRecordingRequest,
  ReprocessRequest,
  ReprocessResult,
} from "../shared/ipc.js";
import { resolveRunDocumentPath, resolveRunFolderPath, RUN_NOTES_FILE, RUN_TRANSCRIPT_FILE } from "./run-access.js";
import { validatePromptModelSelection } from "./model-validation.js";
import { getStore } from "./store.js";
import { indexRun as chatIndexRun } from "./chat-index/index-run.js";
import { createOllamaEmbedder, DEFAULT_EMBEDDING_MODEL } from "@meeting-notes/engine";

/**
 * Parse speaker excerpts from a saved transcript.md body. The markdown
 * format uses `### Me` / `### Others` headers with timestamped lines below.
 * Returns the text lines under each header, stripped of timestamps.
 */
function parseSpeakerExcerptsFromMarkdown(body: string): {
  meExcerpts: string;
  othersExcerpts: string;
} {
  const meLines: string[] = [];
  const othersLines: string[] = [];
  let currentSpeaker: "me" | "others" | null = null;

  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "### Me") {
      currentSpeaker = "me";
      continue;
    }
    if (trimmed === "### Others") {
      currentSpeaker = "others";
      continue;
    }
    if (!trimmed || !currentSpeaker) continue;
    // Strip the leading timestamp (e.g. `00:42`) if present.
    const text = trimmed.replace(/^`\d{2,}:\d{2}`\s*/, "");
    if (!text) continue;
    if (currentSpeaker === "me") meLines.push(text);
    else othersLines.push(text);
  }

  return {
    meExcerpts: meLines.join("\n"),
    othersExcerpts: othersLines.join("\n"),
  };
}

function normalizeModelId(id: string | null | undefined): string | null {
  if (!id) return null;
  const trimmed = id.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("claude-")) return trimmed;
  if (trimmed === "qwen3.5" || trimmed === "qwen3.5:latest") return "qwen3.5:9b";
  return trimmed.replace(/:latest$/, "");
}

export async function reprocessRun(
  req: ReprocessRequest,
  onProgress?: (event: PipelineProgressEvent) => void,
  signal?: AbortSignal
): Promise<ReprocessResult> {
  const config = loadConfig();
  const runFolder = resolveRunFolderPath(req.runFolder, config);
  const store = getStore();
  const manifest = store.loadManifest(runFolder);
  const defaultModel =
    config.llm_provider === "ollama" ? config.ollama.model : (config.llm_provider === "openai" ? config.openai.model : config.claude.model);
  const claudeKey = await getSecret("claude");
  const openaiKey = await getSecret("openai");

  if (config.llm_provider === "claude" && !claudeKey) {
    throw new Error("No Anthropic API key in Keychain — set one in Settings.");
  }
  if (config.llm_provider === "openai" && !openaiKey) {
    throw new Error("No OpenAI API key in Keychain — set one in Settings.");
  }

  const claudeCache: Record<string, ClaudeProvider> = {};
  const openaiCache: Record<string, OpenAIProvider> = {};
  const ollamaCache: Record<string, OllamaProvider> = {};
  const llmFactory = (model?: string): LlmProvider => {
    const id = model && model.trim() ? model : defaultModel;
    const kind = classifyModel(id);
    if (kind === "claude") {
      if (!claudeKey) {
        throw new Error(
          `Prompt requested Claude model "${id}" but no Anthropic API key is set in Settings.`
        );
      }
      return (claudeCache[id] ??= new ClaudeProvider(claudeKey, id));
    }
    if (kind === "openai") {
      if (!openaiKey) {
        throw new Error(
          `Prompt requested OpenAI model "${id}" but no OpenAI API key is set in Settings.`
        );
      }
      return (openaiCache[id] ??= new OpenAIProvider(openaiKey, id));
    }
    const normalizedId = normalizeModelId(id) || id;
    return (ollamaCache[normalizedId] ??= new OllamaProvider(config.ollama.base_url, normalizedId, config.ollama.num_ctx));
  };

  const logger = createRunLogger(path.join(runFolder, "run.log"), Boolean(process.env.VITE_DEV_SERVER_URL));
  const prompts = loadAllPrompts(config);
  const requestedPromptIds = req.onlyIds ?? [];
  const promptsToValidate =
    requestedPromptIds.length > 0
      ? prompts.filter((prompt) => requestedPromptIds.includes(prompt.id))
      : prompts;
  for (const prompt of promptsToValidate) {
    await validatePromptModelSelection(prompt.model, {
      baseUrl: config.ollama.base_url,
    });
  }

  // Flip to "processing" once all preflight checks have passed. The terminal
  // status (complete/error) is written again at end-of-run below, so the list
  // chip reflects in-flight state instead of the prior error/complete label.
  updateRunStatus(runFolder, "processing", {}, store);

  const transcriptPath = resolveRunDocumentPath(runFolder, RUN_TRANSCRIPT_FILE, config);
  const notesPath = resolveRunDocumentPath(runFolder, RUN_NOTES_FILE, config);
  const transcript = fs.existsSync(transcriptPath)
    ? matter(fs.readFileSync(transcriptPath, "utf-8")).content
    : "";
  const notes = fs.existsSync(notesPath) ? fs.readFileSync(notesPath, "utf-8") : "";

  // Rebuild speaker excerpts from the saved transcript markdown.
  const { meExcerpts, othersExcerpts } = parseSpeakerExcerptsFromMarkdown(transcript);

  // Read prep notes and attachments for pipeline context
  const prepPath = path.join(runFolder, "prep.md");
  const prepNotes = fs.existsSync(prepPath) ? fs.readFileSync(prepPath, "utf-8") : "";
  const attachmentsDir = path.join(runFolder, "attachments");
  let attachmentContext = "";
  if (fs.existsSync(attachmentsDir)) {
    for (const entry of fs.readdirSync(attachmentsDir)) {
      const ext = path.extname(entry).toLowerCase();
      if ([".txt", ".md"].includes(ext)) {
        attachmentContext += `\n\n--- ${entry} ---\n` + fs.readFileSync(path.join(attachmentsDir, entry), "utf-8");
      }
    }
  }

  const llmCall: LlmCallFn = (
    systemPrompt: string,
    userMessage: string,
    model?: string,
    callSignal?: AbortSignal,
    temperature?: number,
    onTokenProgress?: (tokensGenerated: number, charsGenerated: number) => void,
  ) => llmFactory(model).call(systemPrompt, userMessage, model, { signal: callSignal, temperature, onTokenProgress });
  const plannedPrompts = await planPipelineSteps(config, runFolder, logger, {
    onlyIds: req.onlyIds,
    onlyFailed: req.onlyFailed,
    skipComplete: req.skipComplete,
    autoOnly: req.autoOnly,
    store,
  });
  onProgress?.({
    type: "run-planned",
    steps: plannedPrompts.map((prompt) => ({
      promptOutputId: prompt.id,
      label: prompt.label,
      filename: prompt.filename,
      model: prompt.model ?? defaultModel,
      kind: "prompt" as const,
    })),
  });

  let results;
  try {
    results = await runPipeline(
      config,
      runFolder,
      {
        transcript,
        manualNotes: notes,
        title: manifest.title,
        date: manifest.date,
        meExcerpts,
        othersExcerpts,
        prepNotes,
        attachmentContext,
      },
      llmCall,
      logger,
      {
        onlyIds: req.onlyIds,
        onlyFailed: req.onlyFailed,
        skipComplete: req.skipComplete,
        autoOnly: req.autoOnly,
        onProgress,
        signal,
        plannedPrompts,
        store,
      }
    );
  } catch (err) {
    // Pipeline threw before completing — we set status to "processing" at
    // kickoff so we must flip it back to "error" to avoid a permanent
    // phantom-processing row.
    updateRunStatus(runFolder, "error", { ended: new Date().toISOString() }, store);
    throw err;
  }

  // Free Ollama model memory now that all prompts are done.
  if (config.llm_provider === "ollama") {
    try {
      await unloadOllamaModels(config.ollama.base_url);
    } catch {
      // Best effort — don't fail the reprocess over cleanup.
    }
  }

  const succeeded = results.filter((result) => result.success).map((result) => result.promptOutputId);
  const failed = results.filter((result) => !result.success).map((result) => result.promptOutputId);

  // Update the overall run status based on pipeline results.
  // When prompts ran, status reflects whether any failed.
  // When 0 prompts ran (e.g. skipComplete filtered everything out),
  // reconcile: if the run is stuck in "error" but all outputs are
  // actually complete, flip it to "complete".
  if (succeeded.length > 0 || failed.length > 0) {
    const endedIso = new Date().toISOString();
    updateRunStatus(
      runFolder,
      failed.length === 0 ? "complete" : "error",
      { ended: endedIso },
      store
    );
  } else {
    const currentManifest = store.loadManifest(runFolder);
    if (currentManifest.status === "error" || currentManifest.status === "processing") {
      const outputs = Object.values(currentManifest.prompt_outputs);
      const hasFailedOutputs = outputs.some((o) => o.status === "failed");
      if (!hasFailedOutputs) {
        updateRunStatus(runFolder, "complete", { ended: new Date().toISOString() }, store);
      }
    }
  }

  // Re-index for chat retrieval now that prompt outputs (e.g. summary) may
  // have changed. Best-effort.
  try {
    const embedder = createOllamaEmbedder({
      baseUrl: config.ollama.base_url,
      model: DEFAULT_EMBEDDING_MODEL,
    });
    await chatIndexRun(runFolder, { embedder });
  } catch (err) {
    logger.warn("chat-index reprocess hook failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { runFolder, succeeded, failed };
}

export function collectRunAudioFiles(runFolder: string, sourceMode: string) {
  const audioDir = path.join(runFolder, "audio");
  if (!fs.existsSync(audioDir)) return [];

  const audioFiles: { path: string; speaker: "me" | "others" | "unknown" }[] = [];

  // Prefer the AEC-cleaned mic over the raw mic when it exists. The engine's
  // processing job writes `mic.clean.wav` alongside `mic.wav` after removing
  // re-captured system audio; reprocessing should read the cleaned file so
  // speaker attribution stays consistent with the first run.
  const preferredMic = (dir: string): string | null => {
    const cleaned = path.join(dir, "mic.clean.wav");
    if (fs.existsSync(cleaned)) return cleaned;
    const raw = path.join(dir, "mic.wav");
    if (fs.existsSync(raw)) return raw;
    return null;
  };

  // Walk timestamped segment subdirectories first (segment layout is the
  // default; the flat layout is a legacy fallback). Sorting alphabetically
  // on the ISO-style names is equivalent to chronological order.
  const segmentDirs = fs
    .readdirSync(audioDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const segDir of segmentDirs) {
    const segPath = path.join(audioDir, segDir.name);
    const segMic = preferredMic(segPath);
    const segSystem = path.join(segPath, "system.wav");
    if (segMic) audioFiles.push({ path: segMic, speaker: "me" });
    if (fs.existsSync(segSystem)) audioFiles.push({ path: segSystem, speaker: "others" });
  }
  if (audioFiles.length > 0) return audioFiles;

  // Legacy flat layout fallback (mic[.clean].wav / system.wav directly in audio/).
  const flatMic = preferredMic(audioDir);
  const flatSystem = path.join(audioDir, "system.wav");
  if (flatMic || fs.existsSync(flatSystem)) {
    if (flatMic) audioFiles.push({ path: flatMic, speaker: "me" });
    if (fs.existsSync(flatSystem)) audioFiles.push({ path: flatSystem, speaker: "others" });
    return audioFiles;
  }

  // Final fallback: loose files in audio/ (imported recordings, etc.).
  const audioEntries = fs
    .readdirSync(audioDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(audioDir, entry.name));

  if (sourceMode === "file" && audioEntries.length > 0) {
    return [{ path: audioEntries[0], speaker: "unknown" as const }];
  }

  return audioEntries.map((audioPath) => ({ path: audioPath, speaker: "unknown" as const }));
}

export async function processRecordedRun(
  req: ProcessRecordingRequest,
  onProgress?: (event: PipelineProgressEvent) => void,
  signal?: AbortSignal
): Promise<ReprocessResult> {
  const config = loadConfig();
  const runFolder = resolveRunFolderPath(req.runFolder, config);
  const store = getStore();
  const manifest = store.loadManifest(runFolder);
  const logger = createRunLogger(path.join(runFolder, "run.log"), Boolean(process.env.VITE_DEV_SERVER_URL));
  const prompts = loadAllPrompts(config);
  const requestedPromptIds = req.onlyIds ?? [];
  const promptsToValidate = prompts.filter((prompt) => requestedPromptIds.includes(prompt.id));

  for (const prompt of promptsToValidate) {
    await validatePromptModelSelection(prompt.model, {
      baseUrl: config.ollama.base_url,
    });
  }

  const audioFiles = collectRunAudioFiles(runFolder, manifest.source_mode);
  if (audioFiles.length === 0) {
    throw new Error("This meeting does not contain a usable audio recording.");
  }

  const result = await processRun({
    config,
    runFolder,
    title: manifest.title,
    date: manifest.date,
    audioFiles,
    logger,
    onlyIds: req.onlyIds ?? [],
    onProgress,
    signal,
    store,
  });

  // Post-process: index the run for chat retrieval. Best-effort — swallow
  // any error so a failed embed doesn't break the surrounding processing
  // flow. Uses nomic-embed-text via the Ollama daemon the user already
  // configured for pipeline calls.
  try {
    const embedder = createOllamaEmbedder({
      baseUrl: config.ollama.base_url,
      model: DEFAULT_EMBEDDING_MODEL,
    });
    await chatIndexRun(runFolder, { embedder });
  } catch (err) {
    logger.warn("chat-index post-process failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    runFolder,
    succeeded: result.succeeded,
    failed: result.failed,
  };
}

export async function bulkReprocessRuns(
  req: BulkReprocessRequest,
  reprocessSingle: (request: ReprocessRequest) => Promise<ReprocessResult>
): Promise<BulkReprocessResult[]> {
  const results: BulkReprocessResult[] = [];

  for (const runFolder of req.runFolders) {
    try {
      const result = await reprocessSingle({
        runFolder,
        onlyIds: req.onlyIds,
      });
      results.push({
        runFolder: result.runFolder,
        succeeded: result.succeeded,
        failed: result.failed,
      });
    } catch (err) {
      results.push({
        runFolder,
        succeeded: [],
        failed: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
