import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { AppConfig, getConfigDir } from "./config.js";
import { writeMarkdownFile } from "./markdown.js";
import { updatePromptOutput } from "./run.js";
import type { RunStore } from "./run-store.js";
import { migrateVaultPromptsToHome } from "./migrate-prompts.js";
import { isAllowedPromptOutputFilename } from "./prompt-validation.js";
import { Logger } from "../logging/logger.js";
import { throwIfAborted } from "./abort.js";

/**
 * Callback the pipeline invokes to report per-section progress. The
 * Electron app subscribes to this to stream a live status panel; the
 * CLI ignores it (its logs already tell the same story).
 */
export type PipelineProgressEvent =
  | {
      type: "run-planned";
      steps: PipelinePlannedStep[];
    }
  | { type: "output-start"; promptOutputId: string; label: string; filename: string; model?: string }
  | {
      type: "output-complete";
      promptOutputId: string;
      label: string;
      filename: string;
      latencyMs: number;
      tokensUsed?: number;
    }
  | {
      type: "output-failed";
      promptOutputId: string;
      label: string;
      filename: string;
      error: string;
      latencyMs: number;
    }
  | {
      type: "output-progress";
      promptOutputId: string;
      tokensGenerated: number;
      charsGenerated: number;
    };

export type LlmCallFn = (
  systemPrompt: string,
  userMessage: string,
  model?: string,
  signal?: AbortSignal,
  temperature?: number,
  onTokenProgress?: (tokensGenerated: number, charsGenerated: number) => void,
) => Promise<{
  content: string;
  tokensUsed?: number;
  promptTokens?: number;
  completionTokens?: number;
  loadDurationMs?: number;
  promptEvalTokensPerSec?: number;
  evalTokensPerSec?: number;
}>;

export interface PipelineInput {
  transcript: string;
  manualNotes: string;
  title: string;
  date: string;
  /** Just the "me"-labeled segments, joined */
  meExcerpts: string;
  /** Just the "others"-labeled segments, joined */
  othersExcerpts: string;
  /** Prep notes written before the meeting (from prep.md). */
  prepNotes?: string;
  /** Text content extracted from attached documents, concatenated. */
  attachmentContext?: string;
}

export interface PipelineResult {
  promptOutputId: string;
  filename: string;
  content: string;
  success: boolean;
  error?: string;
  tokensUsed?: number;
  latencyMs?: number;
  attempts?: number;
}

export interface PipelinePlannedStep {
  promptOutputId: string;
  label: string;
  filename: string;
  model?: string;
  kind: "transcript" | "prompt";
}

export interface PipelineRunOptions {
  /** Run only these section ids. Bypasses autoOnly filter. */
  onlyIds?: string[];
  /** Skip sections that already have status='complete' */
  skipComplete?: boolean;
  /** Run only sections with status='failed' */
  onlyFailed?: boolean;
  /** Max retry attempts for transient failures */
  maxAttempts?: number;
  /**
   * When true, skip prompts whose frontmatter has `auto: false`.
   * Builtin prompts always run. Ignored when `onlyIds` is set.
   */
  autoOnly?: boolean;
  /** Live progress callback (Electron app subscribes; CLI ignores). */
  onProgress?: (event: PipelineProgressEvent) => void;
  /** Optional abort signal to cancel queued/running work. */
  signal?: AbortSignal;
  /** Optional precomputed prompt plan so callers can publish roadmap state once up front. */
  plannedPrompts?: ResolvedPrompt[];
  /** Optional RunStore for state persistence (SQLite in app, filesystem in CLI). */
  store?: RunStore;
}

/**
 * A prompt loaded from the vault, ready to be rendered and dispatched.
 */
export interface ResolvedPrompt {
  id: string;
  label: string;
  description: string | null;
  sortOrder: number | null;
  filename: string;
  prompt: string;
  enabled: boolean;
  auto: boolean;
  builtin: boolean;
  /** Optional per-prompt model override; null falls back to config.claude.model. */
  model: string | null;
  /** Optional per-prompt temperature override; null falls back to provider default. */
  temperature: number | null;
  /** Absolute path to the source .md file */
  sourcePath: string;
}

// --- Default prompt resolution (shipped with the package) ---

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Directory of factory-default prompts shipped with the package.
 * At runtime this resolves to `dist/defaults/prompts/` (copied from
 * `src/defaults/prompts/` by the build script).
 */
export const DEFAULT_PROMPTS_DIR = path.resolve(__dirname, "../defaults/prompts");

/**
 * Prompts live in `~/.gistlist/prompts/` — outside the data directory
 * so they're never touched by Obsidian. This is the single source of truth
 * for prompt location; callers no longer take config.
 */
export function getPromptsDir(): string {
  return path.join(getConfigDir(), "prompts");
}

/**
 * Legacy path inside a vault — used only by the one-shot migration in
 * `migrate-prompts.ts`. Do not use in new code.
 */
export function getLegacyVaultPromptsDir(config: AppConfig): string {
  // Historically: {data_path}/Config/Prompts
  const homeExpanded = config.data_path.replace(
    /^~/,
    os.homedir()
  );
  return path.join(homeExpanded, "Config", "Prompts");
}

interface PromptFrontmatter {
  id?: unknown;
  label?: unknown;
  description?: unknown;
  sort_order?: unknown;
  filename?: unknown;
  enabled?: unknown;
  auto?: unknown;
  builtin?: unknown;
  model?: unknown;
  temperature?: unknown;
}

function parsePromptFile(filePath: string, logger?: Logger): ResolvedPrompt | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    logger?.warn("Failed to read prompt file", {
      path: filePath,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  let parsed: ReturnType<typeof matter>;
  try {
    parsed = matter(raw);
  } catch (err) {
    logger?.warn("Failed to parse prompt frontmatter", {
      path: filePath,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  const fm = parsed.data as PromptFrontmatter;
  const body = parsed.content.trim();

  if (typeof fm.id !== "string" || !fm.id) {
    logger?.warn("Prompt file missing required 'id' field, skipping", { path: filePath });
    return null;
  }
  if (typeof fm.label !== "string" || !fm.label) {
    logger?.warn("Prompt file missing required 'label' field, skipping", { path: filePath });
    return null;
  }
  if (typeof fm.filename !== "string" || !fm.filename) {
    logger?.warn("Prompt file missing required 'filename' field, skipping", { path: filePath });
    return null;
  }
  if (!isAllowedPromptOutputFilename(fm.filename)) {
    logger?.warn(
      "Prompt 'filename' is invalid (must be a basename ending in .md and not a reserved run-folder filename), skipping",
      { path: filePath, filename: fm.filename }
    );
    return null;
  }
  if (!body) {
    logger?.warn("Prompt file has empty body, skipping", { path: filePath });
    return null;
  }

  const builtin = fm.builtin === true;
  const enabled = fm.enabled !== false;
  const auto = fm.auto === true;

  return {
    id: fm.id,
    label: fm.label,
    description:
      typeof fm.description === "string" && fm.description.trim()
        ? fm.description.trim()
        : null,
    sortOrder:
      typeof fm.sort_order === "number" && Number.isFinite(fm.sort_order)
        ? fm.sort_order
        : null,
    filename: fm.filename,
    prompt: body,
    enabled,
    auto,
    builtin,
    model: typeof fm.model === "string" && fm.model.trim() ? fm.model.trim() : null,
    temperature:
      typeof fm.temperature === "number" && Number.isFinite(fm.temperature)
        ? fm.temperature
        : null,
    sourcePath: filePath,
  };
}

/**
 * Load every prompt from `~/.gistlist/prompts/`.
 * Backfills any newly shipped default prompts that are missing locally
 * without overwriting user-edited files. Returns builtin prompts first,
 * then the rest alphabetically by filename.
 *
 * If `config` is provided and legacy prompts still exist in the vault,
 * they are migrated lazily on first load (idempotent).
 */
export function loadAllPrompts(config?: AppConfig, logger?: Logger): ResolvedPrompt[] {
  const dir = getPromptsDir();

  // Lazy migration from the legacy vault location, if any.
  // (migrate-prompts.ts imports from this file; ES module cycles are fine
  // because we only reference the export at call time, not init time.)
  if (config) {
    try {
      migrateVaultPromptsToHome(config);
    } catch (err) {
      logger?.warn("Prompt migration skipped", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const seededDefaults = seedAllDefaultPrompts(dir);
  if (seededDefaults.length > 0) {
    logger?.info("Seeded missing shipped prompt defaults", {
      dir,
      count: seededDefaults.length,
    });
  }

  let files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  const prompts: ResolvedPrompt[] = [];
  const seenIds = new Set<string>();

  for (const file of files) {
    const filePath = path.join(dir, file);
    const prompt = parsePromptFile(filePath, logger);
    if (!prompt) continue;
    if (seenIds.has(prompt.id)) {
      logger?.warn("Duplicate prompt id, keeping first occurrence", {
        id: prompt.id,
        path: filePath,
      });
      continue;
    }
    seenIds.add(prompt.id);
    prompts.push(prompt);
  }

  // Self-heal: ensure at least one builtin exists even if the shipped
  // defaults are unavailable or unreadable for some reason.
  const hasBuiltin = prompts.some((p) => p.builtin);
  if (!hasBuiltin) {
    logger?.warn("No builtin prompt found, re-seeding default summary", { dir });
    const seeded = seedDefaultPrompt("summary.md", dir);
    if (seeded) {
      const prompt = parsePromptFile(seeded, logger);
      if (prompt) prompts.unshift(prompt);
    }
  }

  // Sort: builtins first, then explicit sort order, then alphabetical by label.
  prompts.sort((a, b) => {
    if (a.builtin && !b.builtin) return -1;
    if (!a.builtin && b.builtin) return 1;
    if (a.sortOrder != null && b.sortOrder != null && a.sortOrder !== b.sortOrder) {
      return a.sortOrder - b.sortOrder;
    }
    if (a.sortOrder != null && b.sortOrder == null) return -1;
    if (a.sortOrder == null && b.sortOrder != null) return 1;
    return a.label.localeCompare(b.label);
  });

  return prompts;
}

/**
 * Copy a single default prompt file into the vault prompts directory.
 * Returns the destination path if copied (or already present), null on failure.
 */
export function seedDefaultPrompt(fileName: string, destDir: string): string | null {
  const src = path.join(DEFAULT_PROMPTS_DIR, fileName);
  const dest = path.join(destDir, fileName);
  if (!fs.existsSync(src)) return null;
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, dest);
  return dest;
}

/**
 * Seed every default prompt into the vault directory. Existing files
 * are left untouched so repeated init calls don't clobber user edits.
 * Returns the list of files that were newly created.
 */
export function seedAllDefaultPrompts(destDir: string): string[] {
  if (!fs.existsSync(DEFAULT_PROMPTS_DIR)) return [];
  fs.mkdirSync(destDir, { recursive: true });
  const created: string[] = [];
  for (const file of fs.readdirSync(DEFAULT_PROMPTS_DIR)) {
    if (!file.endsWith(".md")) continue;
    const dest = path.join(destDir, file);
    if (fs.existsSync(dest)) continue;
    fs.copyFileSync(path.join(DEFAULT_PROMPTS_DIR, file), dest);
    created.push(dest);
  }
  return created;
}

/**
 * Overwrite one or all builtin prompts from the shipped defaults.
 * If `fileName` is omitted, resets every file that exists in DEFAULT_PROMPTS_DIR.
 */
export function resetDefaultPrompts(destDir: string, fileName?: string): string[] {
  if (!fs.existsSync(DEFAULT_PROMPTS_DIR)) return [];
  fs.mkdirSync(destDir, { recursive: true });
  const written: string[] = [];
  const files = fileName
    ? [fileName]
    : fs.readdirSync(DEFAULT_PROMPTS_DIR).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const src = path.join(DEFAULT_PROMPTS_DIR, file);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(destDir, file);
    fs.copyFileSync(src, dest);
    written.push(dest);
  }
  return written;
}

/**
 * Read a prompt file, merge `patch` into its frontmatter, and rewrite
 * the file preserving the body. Returns the updated prompt, or null if
 * the file doesn't exist or can't be parsed.
 */
export function updatePromptFrontmatter(
  _config: AppConfig | undefined,
  id: string,
  patch: Record<string, unknown>,
  logger?: Logger
): ResolvedPrompt | null {
  const prompts = loadAllPrompts(undefined, logger);
  const existing = prompts.find((p) => p.id === id);
  if (!existing) return null;

  const raw = fs.readFileSync(existing.sourcePath, "utf-8");
  const parsed = matter(raw);
  const merged = { ...parsed.data, ...patch };
  const rewritten = matter.stringify(parsed.content, merged);
  fs.writeFileSync(existing.sourcePath, rewritten, "utf-8");

  return parsePromptFile(existing.sourcePath, logger);
}

/**
 * Substitute {{variable}} placeholders in a prompt string.
 * Supported variables: title, date, transcript, notes, me_excerpts, others_excerpts
 */
export function renderPromptTemplate(template: string, input: PipelineInput): string {
  const vars: Record<string, string> = {
    title: input.title,
    date: input.date,
    transcript: input.transcript,
    notes: input.manualNotes,
    me_excerpts: input.meExcerpts,
    others_excerpts: input.othersExcerpts,
    prep_notes: input.prepNotes ?? "",
    attachment_context: input.attachmentContext ?? "",
  };

  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    return key in vars ? vars[key] : match;
  });
}

export function buildUserMessage(input: PipelineInput): string {
  let message = `# Meeting: ${input.title}\n**Date:** ${input.date}\n\n`;

  if (input.transcript) {
    message += `## Transcript\n\n${input.transcript}\n\n`;
  }

  if (input.manualNotes && input.manualNotes.trim()) {
    message += `## Manual Notes\n\n${input.manualNotes}\n\n`;
  }

  if (input.prepNotes && input.prepNotes.trim()) {
    message += `## Prep Notes\n\n${input.prepNotes}\n\n`;
  }

  if (input.attachmentContext && input.attachmentContext.trim()) {
    message += `## Attached Documents\n\n${input.attachmentContext}\n\n`;
  }

  return message;
}

function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  // Retry on network errors, rate limits, server errors, timeouts
  return (
    msg.includes("rate limit") ||
    msg.includes("429") ||
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("econnrefused") ||
    msg.includes("fetch failed") ||
    msg.includes("overloaded")
  );
}

async function callWithRetry(
  llmCall: LlmCallFn,
  systemPrompt: string,
  userMessage: string,
  maxAttempts: number,
  logger: Logger,
  promptOutputId: string,
  model?: string,
  signal?: AbortSignal,
  temperature?: number,
  onTokenProgress?: (tokensGenerated: number, charsGenerated: number) => void,
): Promise<{
  content: string;
  tokensUsed?: number;
  promptTokens?: number;
  completionTokens?: number;
  attempts: number;
  loadDurationMs?: number;
  promptEvalTokensPerSec?: number;
  evalTokensPerSec?: number;
}> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      throwIfAborted(signal);
      const response = await llmCall(systemPrompt, userMessage, model, signal, temperature, onTokenProgress);
      return { ...response, attempts: attempt };
    } catch (err) {
      lastError = err;
      throwIfAborted(signal);
      const retryable = isRetryableError(err);
      const errorMsg = err instanceof Error ? err.message : String(err);

      if (!retryable || attempt >= maxAttempts) {
        logger.warn(`Prompt output ${promptOutputId} failed (attempt ${attempt}/${maxAttempts}, no retry)`, {
          error: errorMsg,
          retryable,
        });
        throw err;
      }

      const delayMs = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
      logger.warn(`Prompt output ${promptOutputId} failed (attempt ${attempt}/${maxAttempts}, retrying in ${delayMs}ms)`, {
        error: errorMsg,
      });
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  throw lastError;
}

export async function runPipeline(
  config: AppConfig,
  runFolderPath: string,
  input: PipelineInput,
  llmCall: LlmCallFn,
  logger: Logger,
  options: PipelineRunOptions = {}
): Promise<PipelineResult[]> {
  const {
    maxAttempts = 3,
    autoOnly,
    onProgress,
    signal,
    plannedPrompts,
    store,
  } = options;

  const defaultModel =
    config.llm_provider === "ollama" ? config.ollama.model : (config.llm_provider === "openai" ? config.openai.model : config.claude.model);

  const allPrompts =
    plannedPrompts ?? await planPipelineSteps(config, runFolderPath, logger, options);

  if (allPrompts.length === 0) {
    logger.info("No sections to run after filtering", {
      onlyIds: options.onlyIds,
      skipComplete: options.skipComplete,
      onlyFailed: options.onlyFailed,
      autoOnly,
    });
    return [];
  }

  logger.info(`Running pipeline with ${allPrompts.length} prompt outputs`, {
    promptOutputIds: allPrompts.map((p) => p.id),
    maxAttempts,
    autoOnly: autoOnly ?? false,
  });

  const userMessage = buildUserMessage(input);
  const results: PipelineResult[] = [];

  for (const prompt of allPrompts) {
    throwIfAborted(signal);
    updatePromptOutput(runFolderPath, prompt.id, {
      status: "running",
      filename: prompt.filename,
      label: prompt.label,
      builtin: prompt.builtin,
      model: prompt.model ?? defaultModel,
    }, store);
    onProgress?.({
      type: "output-start",
      promptOutputId: prompt.id,
      label: prompt.label,
      filename: prompt.filename,
      model: prompt.model ?? defaultModel,
    });

    const start = Date.now();
    const renderedPrompt = renderPromptTemplate(prompt.prompt, input);
    const inputChars = renderedPrompt.length + userMessage.length;
    logger.info(`Starting prompt output: ${prompt.id}`, {
      label: prompt.label,
      inputChars,
      estimatedInputTokens: Math.ceil(inputChars / 3.5),
    });

    // Build a progress callback that forwards streaming token counts to the UI.
    const tokenProgressCb = onProgress
      ? (tokensGenerated: number, charsGenerated: number) => {
          onProgress({
            type: "output-progress",
            promptOutputId: prompt.id,
            tokensGenerated,
            charsGenerated,
          });
        }
      : undefined;

    try {
      const response = await callWithRetry(
        llmCall,
        renderedPrompt,
        userMessage,
        maxAttempts,
        logger,
        prompt.id,
        prompt.model ?? undefined,
        signal,
        prompt.temperature ?? undefined,
        tokenProgressCb
      );
      throwIfAborted(signal);
      const latencyMs = Date.now() - start;

      writeMarkdownFile(
        path.join(runFolderPath, prompt.filename),
        {
          type: "meeting-output",
          prompt_output_id: prompt.id,
          label: prompt.label,
          generated_at: new Date().toISOString(),
          builtin: prompt.builtin,
          tokens_used: response.tokensUsed,
          attempts: response.attempts,
        },
        response.content
      );

      updatePromptOutput(runFolderPath, prompt.id, {
        status: "complete",
        filename: prompt.filename,
        label: prompt.label,
        builtin: prompt.builtin,
        latency_ms: latencyMs,
        tokens_used: response.tokensUsed,
        completed_at: new Date().toISOString(),
        model: prompt.model ?? defaultModel,
      }, store);

      logger.info(`Completed prompt output: ${prompt.id}`, {
        latencyMs,
        promptTokens: response.promptTokens ?? null,
        completionTokens: response.completionTokens ?? null,
        tokensUsed: response.tokensUsed,
        attempts: response.attempts,
        loadDurationMs: response.loadDurationMs ?? null,
        promptEvalTokensPerSec: response.promptEvalTokensPerSec ?? null,
        evalTokensPerSec: response.evalTokensPerSec ?? null,
      });

      onProgress?.({
        type: "output-complete",
        promptOutputId: prompt.id,
        label: prompt.label,
        filename: prompt.filename,
        latencyMs,
        tokensUsed: response.tokensUsed,
      });

      results.push({
        promptOutputId: prompt.id,
        filename: prompt.filename,
        content: response.content,
        success: true,
        tokensUsed: response.tokensUsed,
        latencyMs,
        attempts: response.attempts,
      });
    } catch (err) {
      throwIfAborted(signal);
      const latencyMs = Date.now() - start;
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed prompt output: ${prompt.id}`, { error: errorMsg, latencyMs });

      updatePromptOutput(runFolderPath, prompt.id, {
        status: "failed",
        filename: prompt.filename,
        label: prompt.label,
        builtin: prompt.builtin,
        error: errorMsg,
        latency_ms: latencyMs,
        model: prompt.model ?? defaultModel,
      }, store);

      onProgress?.({
        type: "output-failed",
        promptOutputId: prompt.id,
        label: prompt.label,
        filename: prompt.filename,
        error: errorMsg,
        latencyMs,
      });

      results.push({
        promptOutputId: prompt.id,
        filename: prompt.filename,
        content: "",
        success: false,
        error: errorMsg,
        latencyMs,
      });
    }
  }

  return results;
}

export async function planPipelineSteps(
  config: AppConfig,
  runFolderPath: string,
  logger: Logger,
  options: Pick<PipelineRunOptions, "onlyIds" | "skipComplete" | "onlyFailed" | "autoOnly" | "store"> = {}
): Promise<ResolvedPrompt[]> {
  const { onlyIds, skipComplete, onlyFailed, autoOnly, store } = options;
  let allPrompts = loadAllPrompts(config, logger);

  const { loadRunManifest } = await import("./run.js");
  const manifest = store ? store.loadManifest(runFolderPath) : loadRunManifest(runFolderPath);

  if (onlyIds && onlyIds.length > 0) {
    allPrompts = allPrompts.filter((p) => onlyIds.includes(p.id));
  } else if (autoOnly) {
    allPrompts = allPrompts.filter((p) => p.enabled && p.auto);
  } else {
    allPrompts = allPrompts.filter((p) => p.enabled);
  }

  if (onlyFailed) {
    allPrompts = allPrompts.filter((p) => manifest.prompt_outputs[p.id]?.status === "failed");
  } else if (skipComplete) {
    allPrompts = allPrompts.filter((p) => manifest.prompt_outputs[p.id]?.status !== "complete");
  }

  return allPrompts;
}
