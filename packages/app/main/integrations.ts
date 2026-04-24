/**
 * Settings → Integrations: Claude Desktop MCP server install flow.
 *
 * The MCP server (packages/mcp-server) is shipped inside the app bundle as
 * extraResources and launched by Claude Desktop as an external child process
 * via `ELECTRON_RUN_AS_NODE=1`. Installing "Gistlist for Claude Desktop"
 * means writing an `mcpServers.gistlist` entry into
 * `~/Library/Application Support/Claude/claude_desktop_config.json` that
 * points at our Electron binary (as a Node runtime) and our bundled
 * server.js.
 *
 * Why not `.mcpb`: Claude Desktop's UtilityProcess (which spawns `.mcpb`
 * servers) enforces macOS library validation and rejects any native module
 * whose Team ID differs from Anthropic's. By running as a Claude-Desktop-
 * managed external child of our own signed app binary, library validation
 * matches against our own Team ID instead — so our signed native modules
 * (better-sqlite3, sqlite-vec) load cleanly.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { pingOllama, loadConfig, createAppLogger } from "@gistlist/engine";
import type {
  McpInstallResult,
  McpIntegrationStatus,
} from "../shared/ipc.js";
import { getDb } from "./db/connection.js";

const appLogger = createAppLogger(false);

const MCP_SERVER_KEY = "gistlist";

const CLAUDE_CONFIG_PATH = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Claude",
  "claude_desktop_config.json"
);

const LEGACY_MCPB_DIR = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Claude",
  "Claude Extensions",
  "local.mcpb.gistlist-llc.gistlist"
);

interface ClaudeConfig {
  mcpServers?: Record<
    string,
    {
      command?: string;
      args?: string[];
      env?: Record<string, string>;
    }
  >;
  [key: string]: unknown;
}

/**
 * Path to the bundled MCP server entrypoint. In the packaged app this lives
 * under `Contents/Resources/mcp-server/server.js` (via electron-builder's
 * extraResources mapping). In dev it resolves to the mcp-server workspace's
 * tsc output.
 */
function resolveServerJsPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "mcp-server", "server.js");
  }
  return path.resolve(app.getAppPath(), "../mcp-server/dist/server.js");
}

function resolveConfigDir(): string {
  const envDir = process.env.GISTLIST_CONFIG_DIR;
  if (envDir && envDir.trim().length > 0) return envDir;
  return path.join(os.homedir(), ".gistlist");
}

function readClaudeConfig(): ClaudeConfig {
  if (!fs.existsSync(CLAUDE_CONFIG_PATH)) return {};
  const raw = fs.readFileSync(CLAUDE_CONFIG_PATH, "utf-8");
  if (raw.trim().length === 0) return {};
  try {
    return JSON.parse(raw) as ClaudeConfig;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Claude Desktop config at ${CLAUDE_CONFIG_PATH} is not valid JSON (${message}). ` +
        `Fix or delete it and try again.`
    );
  }
}

function writeClaudeConfig(config: ClaudeConfig): void {
  fs.mkdirSync(path.dirname(CLAUDE_CONFIG_PATH), { recursive: true });
  // Write-then-rename so Claude Desktop (which may be watching the file)
  // never reads a half-written config.
  const tmp = `${CLAUDE_CONFIG_PATH}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, CLAUDE_CONFIG_PATH);
}

function removeLegacyMcpb(): boolean {
  if (!fs.existsSync(LEGACY_MCPB_DIR)) return false;
  try {
    fs.rmSync(LEGACY_MCPB_DIR, { recursive: true, force: true });
    return true;
  } catch (err) {
    appLogger.warn("integrations: failed to remove legacy .mcpb", {
      detail: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

async function detectClaudeInstalled(): Promise<"yes" | "no" | "unknown"> {
  // Best-effort: if Claude Desktop's app dir exists, assume it's installed.
  // We don't sniff version or launch state — the user just needs to know
  // whether we have somewhere to write the config.
  if (process.platform !== "darwin") return "unknown";
  if (fs.existsSync("/Applications/Claude.app")) return "yes";
  if (fs.existsSync(path.join(os.homedir(), "Applications/Claude.app"))) return "yes";
  return "no";
}

function meetingsIndexed(): number | null {
  try {
    const db = getDb();
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM runs")
      .get() as { n: number } | undefined;
    return row?.n ?? 0;
  } catch {
    return null;
  }
}

async function ollamaRunning(): Promise<boolean> {
  try {
    const config = loadConfig();
    return await pingOllama(config.ollama.base_url);
  } catch {
    return false;
  }
}

function buildEnv(): Record<string, string> {
  let ollamaBaseUrl = "http://127.0.0.1:11434";
  try {
    ollamaBaseUrl = loadConfig().ollama.base_url;
  } catch {
    // Fall through — config may not be initialized yet on first launch.
  }
  return {
    ELECTRON_RUN_AS_NODE: "1",
    GISTLIST_CONFIG_DIR: resolveConfigDir(),
    OLLAMA_BASE_URL: ollamaBaseUrl,
  };
}

export async function getMcpStatus(): Promise<McpIntegrationStatus> {
  const serverJsPath = resolveServerJsPath();
  const [claudeInstalled, ollama] = await Promise.all([
    detectClaudeInstalled(),
    ollamaRunning(),
  ]);

  let configInstalled = false;
  let configReadError: string | null = null;
  try {
    const config = readClaudeConfig();
    configInstalled = Boolean(config.mcpServers?.[MCP_SERVER_KEY]);
  } catch (err) {
    configReadError = err instanceof Error ? err.message : String(err);
  }

  return {
    serverJsPath,
    serverJsExists: fs.existsSync(serverJsPath),
    configInstalled,
    configReadError,
    claudeConfigPath: CLAUDE_CONFIG_PATH,
    claudeDesktopInstalled: claudeInstalled,
    meetingsIndexed: meetingsIndexed(),
    ollamaRunning: ollama,
  };
}

export async function installMcpForClaude(): Promise<McpInstallResult> {
  const serverJsPath = resolveServerJsPath();
  if (!fs.existsSync(serverJsPath)) {
    const msg = app.isPackaged
      ? "Gistlist's bundled MCP server is missing. Try reinstalling Gistlist."
      : `MCP server not built. Run \`npm run build --workspace @gistlist/mcp-server\` first. Expected at: ${serverJsPath}`;
    appLogger.warn("integrations: server.js missing", { detail: serverJsPath });
    return { ok: false, error: msg };
  }

  try {
    const config = readClaudeConfig();
    config.mcpServers = config.mcpServers ?? {};
    const existed = Object.prototype.hasOwnProperty.call(
      config.mcpServers,
      MCP_SERVER_KEY
    );
    config.mcpServers[MCP_SERVER_KEY] = {
      command: process.execPath,
      args: [serverJsPath],
      env: buildEnv(),
    };
    writeClaudeConfig(config);

    const legacyRemoved = removeLegacyMcpb();
    appLogger.info("integrations: install wrote claude_desktop_config.json", {
      detail: JSON.stringify({ existed, legacyRemoved, serverJsPath }),
    });
    return { ok: true, updated: existed, legacyRemoved };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    appLogger.warn("integrations: install failed", { detail: message });
    return { ok: false, error: message };
  }
}

export async function uninstallMcpForClaude(): Promise<McpInstallResult> {
  try {
    const config = readClaudeConfig();
    if (!config.mcpServers || !config.mcpServers[MCP_SERVER_KEY]) {
      return { ok: true, updated: false, legacyRemoved: false };
    }
    delete config.mcpServers[MCP_SERVER_KEY];
    if (Object.keys(config.mcpServers).length === 0) {
      delete config.mcpServers;
    }
    writeClaudeConfig(config);
    appLogger.info("integrations: uninstall removed gistlist entry");
    return { ok: true, updated: true, legacyRemoved: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    appLogger.warn("integrations: uninstall failed", { detail: message });
    return { ok: false, error: message };
  }
}
