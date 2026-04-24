/**
 * Resolves the Gistlist config dir from `GISTLIST_CONFIG_DIR` (set by the
 * Gistlist app's claude_desktop_config.json install flow, or by the
 * `install:claude-dev` script in dev) and exposes derived paths. Falls back
 * to the engine's default `~/.gistlist/`.
 */
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import {
  loadConfig as engineLoadConfig,
  type AppConfig,
} from "@gistlist/engine/core/config.js";

export interface ResolvedConfig {
  configDir: string;
  dbPath: string;
  runsRoot: string;
  ollamaBaseUrl: string;
  appConfig: AppConfig;
}

export function resolveConfig(): ResolvedConfig {
  const configDir = resolveConfigDir();
  // Fail fast with a user-actionable message if the config dir isn't a
  // Gistlist install. The Settings → Integrations status indicator should
  // surface this state too, but at the MCP layer we want every tool call
  // to return a clean error rather than crashing the subprocess.
  if (!fs.existsSync(path.join(configDir, "config.yaml"))) {
    throw new Error(
      `Gistlist config not found at ${configDir}. ` +
        `Open Gistlist once to initialize, then re-run Settings → Integrations → ` +
        `Install Gistlist for Claude Desktop (or "npm run install:claude-dev" in the repo).`
    );
  }

  // Engine's `getConfigDir()` reads `GISTLIST_CONFIG_DIR` first; setting it
  // here ensures `loadConfig()` and any other engine helpers inherit our
  // resolved dir even if our resolution path diverges from the env value.
  process.env.GISTLIST_CONFIG_DIR = configDir;
  const appConfig = engineLoadConfig();

  const dbPath = path.join(configDir, "meetings.db");
  const runsRoot = appConfig.data_path;
  const ollamaBaseUrl =
    process.env.OLLAMA_BASE_URL && process.env.OLLAMA_BASE_URL.length > 0
      ? process.env.OLLAMA_BASE_URL
      : appConfig.ollama.base_url;

  return { configDir, dbPath, runsRoot, ollamaBaseUrl, appConfig };
}

function resolveConfigDir(): string {
  const envDir = process.env.GISTLIST_CONFIG_DIR;
  if (envDir && envDir.trim().length > 0) return expandPlaceholders(envDir.trim());
  return path.join(os.homedir(), ".gistlist");
}

/**
 * Expand `~`, `${HOME}`, `$HOME`, and `${USER_HOME}` placeholders in a path.
 *
 * Defense in depth: the app-side installer resolves the home directory before
 * writing claude_desktop_config.json, so in practice env values arrive fully
 * expanded. We keep this in case a user hand-edits the config to use a
 * placeholder, or an older install left a literal `${HOME}` behind.
 */
function expandPlaceholders(p: string): string {
  let result = p;
  if (result === "~") return os.homedir();
  if (result.startsWith("~/")) result = path.join(os.homedir(), result.slice(2));
  // Replace ${HOME}, $HOME, and ${USER_HOME} (case-insensitive on the var
  // name) anywhere in the string.
  result = result.replace(/\$\{HOME\}|\$HOME(?![A-Z_])|\$\{USER_HOME\}/gi, os.homedir());
  return result;
}
