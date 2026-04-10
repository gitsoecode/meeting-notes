import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import {
  loadConfig,
  loadRunManifest,
  loadAllPrompts,
  planPipelineSteps,
  runPipeline,
  getSecret,
  ClaudeProvider,
  OllamaProvider,
  classifyModel,
  createRunLogger,
  type LlmCallFn,
  type LlmProvider,
  type PipelineProgressEvent,
} from "@meeting-notes/engine";
import type {
  BulkReprocessRequest,
  BulkReprocessResult,
  ReprocessRequest,
  ReprocessResult,
} from "../shared/ipc.js";
import { resolveRunDocumentPath, resolveRunFolderPath, RUN_NOTES_FILE, RUN_TRANSCRIPT_FILE } from "./run-access.js";
import { validatePromptModelSelection } from "./model-validation.js";

function normalizeModelId(id: string | null | undefined): string | null {
  if (!id) return null;
  const trimmed = id.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("claude-")) return trimmed;
  if (trimmed === "qwen3.5:9b" || trimmed === "qwen3.5:latest") return "qwen3.5";
  return trimmed.replace(/:latest$/, "");
}

export async function reprocessRun(
  req: ReprocessRequest,
  onProgress?: (event: PipelineProgressEvent) => void,
  signal?: AbortSignal
): Promise<ReprocessResult> {
  const config = loadConfig();
  const runFolder = resolveRunFolderPath(req.runFolder, config);
  const manifest = loadRunManifest(runFolder);
  const defaultModel =
    config.llm_provider === "ollama" ? config.ollama.model : config.claude.model;
  const apiKey = await getSecret("claude");

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
    const normalizedId = normalizeModelId(id) || id;
    return (ollamaCache[normalizedId] ??= new OllamaProvider(config.ollama.base_url, normalizedId));
  };

  const logger = createRunLogger(path.join(runFolder, "run.log"), false);
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
  const transcriptPath = resolveRunDocumentPath(runFolder, RUN_TRANSCRIPT_FILE, config);
  const notesPath = resolveRunDocumentPath(runFolder, RUN_NOTES_FILE, config);
  const transcript = fs.existsSync(transcriptPath)
    ? matter(fs.readFileSync(transcriptPath, "utf-8")).content
    : "";
  const notes = fs.existsSync(notesPath) ? fs.readFileSync(notesPath, "utf-8") : "";
  const llmCall: LlmCallFn = (
    systemPrompt: string,
    userMessage: string,
    model?: string,
    callSignal?: AbortSignal
  ) => llmFactory(model).call(systemPrompt, userMessage, model, { signal: callSignal });
  const plannedPrompts = await planPipelineSteps(config, runFolder, logger, {
    onlyIds: req.onlyIds,
    onlyFailed: req.onlyFailed,
    skipComplete: req.skipComplete,
    autoOnly: req.autoOnly,
  });
  onProgress?.({
    type: "run-planned",
    steps: plannedPrompts.map((prompt) => ({
      sectionId: prompt.id,
      label: prompt.label,
      filename: prompt.filename,
      model: prompt.model ?? undefined,
      kind: "prompt" as const,
    })),
  });

  const results = await runPipeline(
    config,
    runFolder,
    {
      transcript,
      manualNotes: notes,
      title: manifest.title,
      date: manifest.date,
      meExcerpts: "",
      othersExcerpts: "",
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
    }
  );

  return {
    runFolder,
    succeeded: results.filter((result) => result.success).map((result) => result.sectionId),
    failed: results.filter((result) => !result.success).map((result) => result.sectionId),
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
