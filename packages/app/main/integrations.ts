/**
 * Settings → Integrations: Claude Desktop MCP extension.
 *
 * The MCP server is a separate stdio subprocess packaged into a `.mcpb`
 * bundle. This module resolves its path, reports live status, and hands
 * the bundle to macOS's registered `.mcpb` handler (Claude Desktop) via
 * `shell.openPath`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, shell } from "electron";
import { pingOllama, loadConfig, createAppLogger } from "@gistlist/engine";
import type {
  McpInstallResult,
  McpIntegrationStatus,
} from "../shared/ipc.js";
import { getDb } from "./db/connection.js";

const appLogger = createAppLogger(false);

/**
 * Locate the bundled Gistlist.mcpb. In a packaged app this lives under
 * `Contents/Resources/mcp/Gistlist.mcpb` (via the electron-builder
 * extraResources mapping). In dev it's the workspace's dist/ output.
 */
function resolveMcpbPath(): string | null {
  // Packaged: app.getAppPath() returns Contents/Resources/app.asar; its
  // sibling is our extraResources target.
  const packagedPath = path.join(process.resourcesPath, "mcp", "Gistlist.mcpb");
  if (fs.existsSync(packagedPath)) return packagedPath;

  // Dev / tests: resolve relative to the app bundle's expected repo layout.
  const devCandidates = [
    path.resolve(app.getAppPath(), "../mcp-server/dist/Gistlist.mcpb"),
    path.resolve(app.getAppPath(), "../../packages/mcp-server/dist/Gistlist.mcpb"),
  ];
  for (const candidate of devCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function detectClaudeExtension(): Promise<"yes" | "no" | "unknown"> {
  // Claude Desktop stores installed extensions under:
  //   macOS: ~/Library/Application Support/Claude/Claude Extensions/<id>/
  // The directory contains extension metadata. If our extension id folder
  // is present, it's installed. Best-effort only — surface "unknown" for
  // any other situation rather than a false negative.
  if (process.platform !== "darwin") return "unknown";
  const extDir = path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "Claude",
    "Claude Extensions"
  );
  try {
    if (!fs.existsSync(extDir)) return "no";
    const entries = fs.readdirSync(extDir, { withFileTypes: true });
    const found = entries.some(
      (e) => e.isDirectory() && /gistlist/i.test(e.name)
    );
    return found ? "yes" : "no";
  } catch {
    return "unknown";
  }
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

export async function getMcpStatus(): Promise<McpIntegrationStatus> {
  const mcpbPath = resolveMcpbPath();
  const [claudeExtensionDetected, ollama] = await Promise.all([
    detectClaudeExtension(),
    ollamaRunning(),
  ]);
  return {
    mcpbPath,
    mcpbExists: mcpbPath != null && fs.existsSync(mcpbPath),
    meetingsIndexed: meetingsIndexed(),
    ollamaRunning: ollama,
    claudeExtensionDetected,
  };
}

export async function installMcpForClaude(): Promise<McpInstallResult> {
  const mcpbPath = resolveMcpbPath();
  if (!mcpbPath || !fs.existsSync(mcpbPath)) {
    const msg = "Gistlist.mcpb not found in the app bundle. Try reinstalling Gistlist.";
    appLogger.warn("integrations: mcpb missing", { detail: mcpbPath ?? "null" });
    return { ok: false, error: msg };
  }
  try {
    // `shell.openPath` returns "" on success; a non-empty string is the
    // error message. Covers "no registered handler" (Claude Desktop not
    // installed) → user gets a toast instead of a silent dead click.
    const result = await shell.openPath(mcpbPath);
    if (result && result.length > 0) {
      appLogger.warn("integrations: shell.openPath failed", { detail: result });
      return {
        ok: false,
        error:
          "Couldn't open Gistlist.mcpb in Claude Desktop. See setup guide.",
      };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    appLogger.warn("integrations: shell.openPath threw", { detail: message });
    return {
      ok: false,
      error: "Couldn't open Gistlist.mcpb in Claude Desktop. See setup guide.",
    };
  }
}
