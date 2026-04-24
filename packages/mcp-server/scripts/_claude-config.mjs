/**
 * Shared helpers for reading/writing Claude Desktop's mcpServers config and
 * cleaning up the legacy .mcpb extension. Used by both install-claude-dev.mjs
 * and uninstall-claude-dev.mjs. The app-side installer
 * (packages/app/main/integrations.ts) implements the same logic in TypeScript
 * — keep behavior aligned.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CLAUDE_CONFIG_PATH = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Claude",
  "claude_desktop_config.json"
);

export const LEGACY_MCPB_DIR = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Claude",
  "Claude Extensions",
  "local.mcpb.gistlist-llc.gistlist"
);

export function readConfig() {
  if (!fs.existsSync(CLAUDE_CONFIG_PATH)) return {};
  const raw = fs.readFileSync(CLAUDE_CONFIG_PATH, "utf-8");
  if (raw.trim().length === 0) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `claude_desktop_config.json at ${CLAUDE_CONFIG_PATH} is not valid JSON. ` +
        `Fix or delete it and retry. (${err.message})`
    );
  }
}

export function writeConfig(config) {
  fs.mkdirSync(path.dirname(CLAUDE_CONFIG_PATH), { recursive: true });
  // Write-then-rename for atomicity; Claude Desktop may be watching the file.
  const tmp = `${CLAUDE_CONFIG_PATH}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, CLAUDE_CONFIG_PATH);
}

export function removeLegacyMcpb() {
  if (!fs.existsSync(LEGACY_MCPB_DIR)) return false;
  fs.rmSync(LEGACY_MCPB_DIR, { recursive: true, force: true });
  return true;
}
