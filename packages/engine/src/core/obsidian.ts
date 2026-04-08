import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import type { AppConfig } from "./config.js";

const execFileAsync = promisify(execFile);

/**
 * Open a file in Obsidian via the obsidian:// URI scheme.
 *
 * Early-returns when `config.obsidian_integration.enabled === false` so
 * call sites don't need to branch on the toggle. The vault is identified
 * by `obsidian_integration.vault_name`; the relative path is computed
 * against `obsidian_integration.vault_path`.
 */
export async function openInObsidian(
  config: AppConfig,
  absoluteFilePath: string
): Promise<void> {
  const integration = config.obsidian_integration;
  if (!integration?.enabled) return;

  const vaultPathRaw = integration.vault_path;
  const vaultName = integration.vault_name;
  if (!vaultPathRaw || !vaultName) return;

  const vaultPath = vaultPathRaw.replace(/^~/, os.homedir());

  // Compute path relative to vault root
  const relativePath = path.relative(vaultPath, absoluteFilePath);
  // Strip extension (Obsidian wants the note path without .md)
  const withoutExt = relativePath.replace(/\.md$/, "");

  const uri = `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(withoutExt)}`;

  try {
    await execFileAsync("open", [uri]);
  } catch {
    // Fail silently — the user can navigate manually
  }
}
