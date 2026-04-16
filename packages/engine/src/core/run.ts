import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { ulid } from "ulid";
import { AppConfig, resolveRunsPath, resolveBasePath } from "./config.js";
import { writeMarkdownFile, writeRawFile } from "./markdown.js";
import { createRunLogger, Logger } from "../logging/logger.js";
import type { RunStore } from "./run-store.js";

export type RunStatus = "draft" | "recording" | "paused" | "processing" | "complete" | "error" | "aborted";
export type PromptOutputStatus = "pending" | "running" | "complete" | "failed";

export interface PromptOutputState {
  status: PromptOutputStatus;
  filename: string;
  label?: string;
  builtin?: boolean;
  error?: string;
  latency_ms?: number;
  tokens_used?: number;
  completed_at?: string;
  model?: string;
}

export interface RunManifest {
  run_id: string;
  title: string;
  description: string | null;
  date: string;
  started: string;
  ended: string | null;
  status: RunStatus;
  source_mode: "both" | "mic" | "file";
  tags: string[];
  participants: string[];
  duration_minutes: number | null;
  asr_provider: string;
  llm_provider: string;
  prompt_outputs: Record<string, PromptOutputState>;
  /** ISO 8601 datetime for when the meeting is scheduled. */
  scheduled_time: string | null;
  /** Filenames stored in the attachments/ subdirectory. */
  attachments: string[];
  /** Pre-configured prompt IDs to run on processing; null = use defaults. */
  selected_prompts: string[] | null;
  /** Timestamped audio segment folder names under audio/. */
  recording_segments: string[];
}

export interface RunContext {
  manifest: RunManifest;
  folderPath: string;
  logger: Logger;
}

function formatDateFolder(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return path.join(String(y), m, d);
}

function formatRunFolderName(date: Date, title: string): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  // macOS silently strips trailing dots and spaces from folder names when the
  // directory is created, so a manifest path ending in `.` ends up pointing
  // at a folder without that dot. Strip both here so the path we persist
  // matches what lands on disk. Also normalize runs of whitespace.
  const safeTitle = title
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/, "");
  const base = `${y}-${m}-${d}_${hh}-${mm}`;
  return safeTitle ? `${base} ${safeTitle}` : base;
}

function getNotesTemplate(config: AppConfig): string {
  const templatePath = path.join(resolveBasePath(config), "Templates", "notes-template.md");
  if (fs.existsSync(templatePath)) {
    return fs.readFileSync(templatePath, "utf-8");
  }
  return "# Meeting Notes\n\n- \n";
}

export interface CreateRunOptions {
  /** Source mode: mic+system, mic only, or existing audio file. */
  sourceMode?: "both" | "mic" | "file";
  /** When true, the run logger does not print to stdout. */
  quiet?: boolean;
}

export function manifestToFrontmatter(manifest: RunManifest): Record<string, unknown> {
  const fm: Record<string, unknown> = {
    type: "meeting-run",
    run_id: manifest.run_id,
    title: manifest.title,
    description: manifest.description,
    date: manifest.date,
    started: manifest.started,
    ended: manifest.ended,
    status: manifest.status,
    source_mode: manifest.source_mode,
    tags: manifest.tags,
    participants: manifest.participants,
    duration_minutes: manifest.duration_minutes,
    asr_provider: manifest.asr_provider,
    llm_provider: manifest.llm_provider,
    prompt_outputs: manifest.prompt_outputs,
  };
  if (manifest.scheduled_time) fm.scheduled_time = manifest.scheduled_time;
  if (manifest.attachments.length > 0) fm.attachments = manifest.attachments;
  if (manifest.selected_prompts) fm.selected_prompts = manifest.selected_prompts;
  if (manifest.recording_segments.length > 0) fm.recording_segments = manifest.recording_segments;
  return fm;
}

export function buildIndexBody(manifest: RunManifest): string {
  const links = ["- [[notes]]"];
  const outputIds = Object.keys(manifest.prompt_outputs);
  if (outputIds.length > 0) {
    links.push("- [[transcript]]");
    for (const id of outputIds) {
      const state = manifest.prompt_outputs[id];
      if (state.status === "complete") {
        const noExt = state.filename.replace(/\.md$/, "");
        links.push(`- [[${noExt}]]`);
      }
    }
  }
  return `# ${manifest.title} — ${manifest.date}\n\n## Files\n${links.join("\n")}\n`;
}

function writeManifest(folderPath: string, manifest: RunManifest): void {
  writeMarkdownFile(
    path.join(folderPath, "index.md"),
    manifestToFrontmatter(manifest),
    buildIndexBody(manifest)
  );
}

export function createRun(
  config: AppConfig,
  title: string,
  sourceModeOrOptions: "both" | "mic" | "file" | CreateRunOptions = "both",
  description: string | null = null
): RunContext {
  const opts: CreateRunOptions =
    typeof sourceModeOrOptions === "string"
      ? { sourceMode: sourceModeOrOptions }
      : sourceModeOrOptions;
  const sourceMode = opts.sourceMode ?? "both";
  const consoleLog = !opts.quiet;
  const now = new Date();
  const runId = ulid();
  const dateFolder = formatDateFolder(now);
  const runFolderName = formatRunFolderName(now, title);
  const folderPath = path.join(resolveRunsPath(config), dateFolder, runFolderName);

  fs.mkdirSync(path.join(folderPath, "audio"), { recursive: true });

  const manifest: RunManifest = {
    run_id: runId,
    title,
    description,
    date: now.toISOString().split("T")[0],
    started: now.toISOString(),
    ended: null,
    status: "recording",
    source_mode: sourceMode,
    tags: [],
    participants: [],
    duration_minutes: null,
    asr_provider: config.asr_provider,
    llm_provider: config.llm_provider,
    prompt_outputs: {},
    scheduled_time: null,
    attachments: [],
    selected_prompts: null,
    recording_segments: [],
  };

  writeManifest(folderPath, manifest);

  // Write notes.md from template
  const notesContent = getNotesTemplate(config);
  writeRawFile(path.join(folderPath, "notes.md"), notesContent);

  const logger = createRunLogger(path.join(folderPath, "run.log"), consoleLog);
  logger.info("Run created", { run_id: runId, title, source_mode: sourceMode });

  return { manifest, folderPath, logger };
}

/**
 * If a run has flat-layout audio files (`audio/mic.wav` + `audio/system.wav`)
 * from before the segmented-layout fix, move them into a back-dated segment
 * directory so subsequent segments don't produce a mixed on-disk layout.
 *
 * The segment name uses the run's `started` timestamp so the pre-fix audio
 * sorts chronologically before any fresh segment created after the pause.
 *
 * Best-effort: if any move fails, the flat files stay in place. Callers
 * should treat this as a no-op on failure rather than aborting the start.
 */
export function migrateFlatLayoutToSegment(runFolder: string, startedIso: string): string | null {
  const audioDir = path.join(runFolder, "audio");
  if (!fs.existsSync(audioDir)) return null;

  const flatMic = path.join(audioDir, "mic.wav");
  const flatSystem = path.join(audioDir, "system.wav");
  const flatMicClean = path.join(audioDir, "mic.clean.wav");
  const flatCaptureMeta = path.join(audioDir, "capture-meta.json");
  const hasFlatMic = fs.existsSync(flatMic);
  const hasFlatSystem = fs.existsSync(flatSystem);
  if (!hasFlatMic && !hasFlatSystem) return null;

  const startedDate = new Date(startedIso);
  const segmentDate = Number.isNaN(startedDate.getTime()) ? new Date() : startedDate;
  const segmentName = formatAudioSegmentName(segmentDate);
  const segmentDir = path.join(audioDir, segmentName);
  if (fs.existsSync(segmentDir)) {
    // Name collision (extremely unlikely post-fix since ms precision); append
    // a numeric suffix so we don't clobber a real segment.
    let suffix = 1;
    let alt = `${segmentDir}-${suffix}`;
    while (fs.existsSync(alt)) {
      suffix++;
      alt = `${segmentDir}-${suffix}`;
    }
    fs.mkdirSync(alt, { recursive: true });
    return alt;
  }
  fs.mkdirSync(segmentDir, { recursive: true });

  const moves: Array<[string, string]> = [];
  if (hasFlatMic) moves.push([flatMic, path.join(segmentDir, "mic.wav")]);
  if (hasFlatSystem) moves.push([flatSystem, path.join(segmentDir, "system.wav")]);
  if (fs.existsSync(flatMicClean)) {
    moves.push([flatMicClean, path.join(segmentDir, "mic.clean.wav")]);
  }
  if (fs.existsSync(flatCaptureMeta)) {
    moves.push([flatCaptureMeta, path.join(segmentDir, "capture-meta.json")]);
  }

  for (const [src, dst] of moves) {
    try {
      fs.renameSync(src, dst);
    } catch {
      try {
        fs.copyFileSync(src, dst);
        fs.unlinkSync(src);
      } catch {
        // Leave the flat file alone if we can't move it — don't silently
        // discard captured audio.
      }
    }
  }

  return path.basename(segmentDir);
}

export function formatAudioSegmentName(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  // Millisecond suffix — back-to-back pause/resume within the same wall-clock
  // second would otherwise collide on the directory name and let two ffmpeg
  // writers stomp on the same file.
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${y}-${mo}-${d}_${hh}-${mm}-${ss}-${ms}`;
}

function getPrepTemplate(config: AppConfig): string {
  const templatePath = path.join(resolveBasePath(config), "Templates", "prep-template.md");
  if (fs.existsSync(templatePath)) {
    return fs.readFileSync(templatePath, "utf-8");
  }
  return "# Talking Points\n\n- \n\n# Agenda\n\n- \n";
}

export interface CreateDraftOptions {
  scheduledTime?: string | null;
  quiet?: boolean;
}

export function createDraftRun(
  config: AppConfig,
  title: string,
  description: string | null = null,
  opts: CreateDraftOptions = {}
): RunContext {
  const consoleLog = !opts.quiet;
  const scheduledDate = opts.scheduledTime ? new Date(opts.scheduledTime) : null;
  const folderDate = scheduledDate && !isNaN(scheduledDate.getTime()) ? scheduledDate : new Date();
  const now = new Date();
  const runId = ulid();
  const dateFolder = formatDateFolder(folderDate);
  const runFolderName = formatRunFolderName(folderDate, title);
  const folderPath = path.join(resolveRunsPath(config), dateFolder, runFolderName);

  fs.mkdirSync(path.join(folderPath, "audio"), { recursive: true });
  fs.mkdirSync(path.join(folderPath, "attachments"), { recursive: true });

  const manifest: RunManifest = {
    run_id: runId,
    title,
    description,
    date: folderDate.toISOString().split("T")[0],
    started: now.toISOString(),
    ended: null,
    status: "draft",
    source_mode: "both",
    tags: [],
    participants: [],
    duration_minutes: null,
    asr_provider: config.asr_provider,
    llm_provider: config.llm_provider,
    prompt_outputs: {},
    scheduled_time: opts.scheduledTime ?? null,
    attachments: [],
    selected_prompts: null,
    recording_segments: [],
  };

  writeManifest(folderPath, manifest);
  writeRawFile(path.join(folderPath, "prep.md"), getPrepTemplate(config));
  writeRawFile(path.join(folderPath, "notes.md"), getNotesTemplate(config));

  const logger = createRunLogger(path.join(folderPath, "run.log"), consoleLog);
  logger.info("Draft run created", { run_id: runId, title, scheduled_time: opts.scheduledTime ?? null });

  return { manifest, folderPath, logger };
}

export function loadRunManifest(folderPath: string): RunManifest {
  const indexPath = path.join(folderPath, "index.md");
  if (!fs.existsSync(indexPath)) {
    throw new Error(`No index.md found at ${folderPath}`);
  }
  const raw = fs.readFileSync(indexPath, "utf-8");
  const parsed = matter(raw);
  const data = parsed.data as Partial<RunManifest>;

  if (!data.run_id || !data.title) {
    throw new Error(`Invalid run manifest at ${indexPath}: missing run_id or title`);
  }

  // Backfill duration_minutes for legacy runs that completed before the
  // engine started writing this field. Computed from started/ended only —
  // we don't persist it here, so the next status update will catch it.
  let duration = data.duration_minutes ?? null;
  if (duration == null && data.started && data.ended) {
    const startMs = Date.parse(data.started);
    const endMs = Date.parse(data.ended);
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      duration = (endMs - startMs) / 60000;
    }
  }

  return {
    run_id: data.run_id,
    title: data.title,
    description: data.description ?? null,
    date: data.date ?? "",
    started: data.started ?? "",
    ended: data.ended ?? null,
    status: (data.status as RunStatus) ?? "complete",
    source_mode: (data.source_mode as "both" | "mic" | "file") ?? "file",
    tags: data.tags ?? [],
    participants: data.participants ?? [],
    duration_minutes: duration,
    asr_provider: data.asr_provider ?? "",
    llm_provider: data.llm_provider ?? "",
    prompt_outputs: (data as Record<string, unknown>).prompt_outputs as Record<string, PromptOutputState> ?? {},
    scheduled_time: (data as Record<string, unknown>).scheduled_time as string ?? null,
    attachments: (data as Record<string, unknown>).attachments as string[] ?? [],
    selected_prompts: (data as Record<string, unknown>).selected_prompts as string[] ?? null,
    recording_segments: (data as Record<string, unknown>).recording_segments as string[] ?? [],
  };
}

export function updateRunStatus(
  folderPath: string,
  status: RunStatus,
  updates?: Partial<RunManifest>,
  store?: RunStore
): RunManifest {
  if (store) return store.updateStatus(folderPath, status, updates);
  const manifest = loadRunManifest(folderPath);
  manifest.status = status;
  if (updates) {
    Object.assign(manifest, updates);
  }
  writeManifest(folderPath, manifest);
  return manifest;
}

export function updatePromptOutput(
  folderPath: string,
  promptOutputId: string,
  state: PromptOutputState,
  store?: RunStore
): void {
  if (store) { store.updatePromptOutput(folderPath, promptOutputId, state); return; }
  const manifest = loadRunManifest(folderPath);
  manifest.prompt_outputs[promptOutputId] = state;
  writeManifest(folderPath, manifest);
}
