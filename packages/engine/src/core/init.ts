import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { AppConfig, resolveBasePath, saveConfig } from "./config.js";
import { writeRawFile } from "./markdown.js";
import { getPromptsDir, seedAllDefaultPrompts } from "./pipeline.js";
import { migrateVaultPromptsToHome } from "./migrate-prompts.js";
import type { Logger } from "../logging/logger.js";

const DASHBOARD_CONTENT = `# Meeting Dashboard

## Recent Meetings
\`\`\`dataview
TABLE title, date, status, duration_minutes as "Duration", tags
FROM "Runs"
WHERE type = "meeting-run"
SORT date DESC
LIMIT 20
\`\`\`

## Pending Processing
\`\`\`dataview
LIST
FROM "Runs"
WHERE status != "complete"
SORT date DESC
\`\`\`
`;

const NOTES_TEMPLATE = `# Gistlist

-
`;

interface LegacyPipelineEntry {
  id?: string;
  label?: string;
  filename?: string;
  prompt?: string;
  enabled?: boolean;
}

/**
 * One-shot migration of the old Config/pipeline.json format into the
 * new prompts directory layout. Each entry becomes a markdown file
 * with frontmatter; `auto: true` is set to preserve today's behavior where
 * every enabled section ran on processing. The old file is renamed to
 * pipeline.json.migrated as a breadcrumb.
 *
 * Returns a summary of what happened, or null if there was nothing to do.
 */
function migrateLegacyPipelineJson(
  basePath: string,
  promptsDir: string
): { migrated: number; legacyPath: string } | null {
  const legacyPath = path.join(basePath, "Config", "pipeline.json");
  if (!fs.existsSync(legacyPath)) return null;

  let parsed: LegacyPipelineEntry[];
  try {
    parsed = JSON.parse(fs.readFileSync(legacyPath, "utf-8")) as LegacyPipelineEntry[];
  } catch {
    // Malformed JSON — leave it alone, don't destroy user data.
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  fs.mkdirSync(promptsDir, { recursive: true });

  let migrated = 0;
  for (const entry of parsed) {
    if (!entry.id || !entry.label || !entry.filename || !entry.prompt) continue;
    const destFile = path.join(promptsDir, `${entry.id}.md`);
    if (fs.existsSync(destFile)) continue; // don't clobber anything already there
    const frontmatter: Record<string, unknown> = {
      id: entry.id,
      label: entry.label,
      filename: entry.filename,
      enabled: entry.enabled !== false,
      auto: true, // preserve pre-migration behavior: everything used to run automatically
    };
    fs.writeFileSync(destFile, matter.stringify(`\n${entry.prompt}\n`, frontmatter), "utf-8");
    migrated += 1;
  }

  // Rename as a breadcrumb — don't delete.
  const migratedPath = `${legacyPath}.migrated`;
  try {
    fs.renameSync(legacyPath, migratedPath);
  } catch {
    // If rename fails, leave original in place.
  }

  return { migrated, legacyPath };
}

export interface BootstrapOptions {
  logger?: Logger;
  onMessage?: (msg: string) => void;
}

export function bootstrapVault(
  config: AppConfig,
  opts: BootstrapOptions = {}
): { created: string[] } {
  const basePath = resolveBasePath(config);
  const created: string[] = [];
  const emit = (msg: string) => {
    opts.onMessage?.(msg);
    opts.logger?.info(msg);
  };

  // Create data directory structure (same shape with or without Obsidian).
  const dirs = [
    basePath,
    path.join(basePath, "Runs"),
    path.join(basePath, "Templates"),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      created.push(dir);
    }
  }

  // Write Dashboard.md unconditionally — it's inert markdown when
  // Obsidian isn't present, so writing it is free.
  const dashboardPath = path.join(basePath, "Dashboard.md");
  if (!fs.existsSync(dashboardPath)) {
    writeRawFile(dashboardPath, DASHBOARD_CONTENT);
    created.push(dashboardPath);
  }

  // Write notes template
  const notesTemplatePath = path.join(basePath, "Templates", "notes-template.md");
  if (!fs.existsSync(notesTemplatePath)) {
    writeRawFile(notesTemplatePath, NOTES_TEMPLATE);
    created.push(notesTemplatePath);
  }

  // Ensure the prompts home dir exists.
  const promptsDir = getPromptsDir();
  fs.mkdirSync(promptsDir, { recursive: true });

  // One-shot migration: move prompts out of the vault's Config/Prompts dir
  // into the home dir if we haven't already.
  const movedFromVault = migrateVaultPromptsToHome(config);
  if (movedFromVault.moved > 0) {
    emit(
      `  Migrated ${movedFromVault.moved} prompt(s) from vault → ${promptsDir}`
    );
  }

  // One-shot migration from the even older pipeline.json format, if present.
  const migration = migrateLegacyPipelineJson(basePath, promptsDir);
  if (migration && migration.migrated > 0) {
    emit(
      `  Migrated ${migration.migrated} prompt(s) from pipeline.json → ${promptsDir} (all set to auto: true — use "prompts manual <id>" to change)`
    );
  }

  // Seed any default prompts that aren't already present.
  const seeded = seedAllDefaultPrompts(promptsDir);
  created.push(...seeded);

  return { created };
}

export function initProject(
  config: AppConfig,
  opts: BootstrapOptions = {}
): void {
  saveConfig(config);
  bootstrapVault(config, opts);
}
