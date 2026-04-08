import fs from "node:fs";
import path from "node:path";
import { AppConfig, resolveBasePath } from "./config.js";
import { getPromptsDir } from "./pipeline.js";

export interface MigratePromptsResult {
  moved: number;
  conflicts: string[];
  from: string;
  to: string;
  skipped: boolean;
}

/**
 * One-shot migration: move prompts from `{data_path}/Config/Prompts/` into
 * `~/.meeting-notes/prompts/`. Idempotent — subsequent runs are no-ops.
 * Leaves a `MIGRATED.txt` breadcrumb in the old location pointing at the
 * new path. If both sides have conflicting files, the incoming vault
 * copy is renamed with a `.conflict-<timestamp>.md` suffix and kept.
 */
export function migrateVaultPromptsToHome(config: AppConfig): MigratePromptsResult {
  const basePath = resolveBasePath(config);
  const legacyDir = path.join(basePath, "Config", "Prompts");
  const homeDir = getPromptsDir();

  const result: MigratePromptsResult = {
    moved: 0,
    conflicts: [],
    from: legacyDir,
    to: homeDir,
    skipped: true,
  };

  if (!fs.existsSync(legacyDir)) return result;

  fs.mkdirSync(homeDir, { recursive: true });

  const files = fs
    .readdirSync(legacyDir)
    .filter((f) => f.endsWith(".md"));
  if (files.length === 0) return result;

  result.skipped = false;
  const ts = Date.now();

  for (const file of files) {
    const src = path.join(legacyDir, file);
    const dest = path.join(homeDir, file);

    if (fs.existsSync(dest)) {
      // Conflict: same filename in both places. Keep the home copy as
      // canonical, preserve the vault copy with a suffix so user edits
      // aren't lost.
      const srcContent = fs.readFileSync(src, "utf-8");
      const destContent = fs.readFileSync(dest, "utf-8");
      if (srcContent === destContent) {
        // Identical — just drop the vault copy.
        fs.rmSync(src, { force: true });
        continue;
      }
      const conflictPath = path.join(
        homeDir,
        `${path.basename(file, ".md")}.conflict-${ts}.md`
      );
      fs.copyFileSync(src, conflictPath);
      fs.rmSync(src, { force: true });
      result.conflicts.push(conflictPath);
      result.moved += 1;
      continue;
    }

    fs.copyFileSync(src, dest);
    fs.rmSync(src, { force: true });
    result.moved += 1;
  }

  // Drop a breadcrumb in the old location.
  try {
    const breadcrumbPath = path.join(legacyDir, "MIGRATED.txt");
    fs.writeFileSync(
      breadcrumbPath,
      `Prompts moved to ${homeDir} on ${new Date().toISOString()}\n` +
        `Edit them via the Meeting Notes app (Prompts view) or\n` +
        `via 'meeting-notes prompts ...' from the CLI.\n`,
      "utf-8"
    );
  } catch {
    // Breadcrumb is best-effort; don't fail migration.
  }

  return result;
}
