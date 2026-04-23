/**
 * Resolves the Gistlist config dir from `GISTLIST_CONFIG_DIR` (set by the
 * MCPB user_config) and exposes derived paths. Falls back to the engine's
 * default `~/.gistlist/`.
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
        `Open Gistlist once to initialize, then verify the "gistlist_config_dir" ` +
        `value in Claude Desktop → Settings → Extensions → Gistlist.`
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
  if (envDir && envDir.trim().length > 0) return expandTilde(envDir.trim());
  return path.join(os.homedir(), ".gistlist");
}

function expandTilde(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}
