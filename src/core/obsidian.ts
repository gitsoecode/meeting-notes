import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import type { AppConfig } from "./config.js";

const execFileAsync = promisify(execFile);

/**
 * Open a file in Obsidian via the obsidian:// URI scheme.
 * Vault is identified by name (the basename of the vault folder).
 * File path is relative to the vault root, without extension.
 */
export async function openInObsidian(config: AppConfig, absoluteFilePath: string): Promise<void> {
  const vaultPath = config.vault_path.replace(/^~/, os.homedir());
  const vaultName = path.basename(vaultPath);

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
