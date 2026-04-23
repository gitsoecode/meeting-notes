#!/usr/bin/env node
/**
 * Gistlist MCP server. Spawned by Claude Desktop over stdio. Read-only
 * access to the user's local meetings.db and runs root. Talks to Ollama
 * on localhost when present (semantic search); otherwise falls back to
 * FTS-only retrieval.
 *
 * No outbound network beyond localhost:11434.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveConfig } from "./config.js";
import { openMeetingsDb } from "./db.js";
import { registerTools } from "./tools.js";
import { registerResources } from "./resources.js";

const SERVER_NAME = "gistlist";
const SERVER_VERSION = "0.1.2";

function trace(msg: string): void {
  // Breadcrumbs to Claude Desktop's MCP log via stderr. Stdout is reserved
  // for JSON-RPC over stdio so anything that prints there corrupts the
  // protocol and the host disconnects without explanation.
  try {
    process.stderr.write(`[gistlist-mcp] ${msg}\n`);
  } catch {
    // ignore — never let logging crash startup
  }
}

async function main(): Promise<void> {
  trace(`starting (node ${process.versions.node}, abi ${process.versions.modules}, electron=${process.versions.electron ?? "no"})`);
  trace(
    `env: GISTLIST_CONFIG_DIR=${process.env.GISTLIST_CONFIG_DIR ?? "<unset>"} OLLAMA_BASE_URL=${process.env.OLLAMA_BASE_URL ?? "<unset>"}`
  );

  const config = resolveConfig();
  trace(`config resolved: configDir=${config.configDir} dbPath=${config.dbPath} runsRoot=${config.runsRoot}`);

  const dbHandle = await openMeetingsDb(config.dbPath);
  trace(`db opened (vecAvailable=${dbHandle.vecAvailable})`);
  if (dbHandle.vecLoadError) {
    trace(`sqlite-vec load failed (${dbHandle.vecLoadError}); falling back to FTS-only retrieval`);
  }

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: {
        tools: {},
        resources: { listChanged: true },
      },
      instructions: [
        "You have read-only access to the user's local Gistlist meetings.",
        "Discovery → reasoning split: use `search_meetings` or `list_recent_meetings` to find candidate run_ids,",
        "then call `get_meeting(run_id)` to read full transcripts and reason from them.",
        "For multi-meeting questions (e.g. 'how did this evolve over our last 5 conversations'),",
        "list the relevant meetings, then call `get_meeting` on each in chronological order.",
        "Snippets returned by `search_meetings` are for routing only — never synthesize answers from snippets alone.",
        "Citations use the form [[cite:run_id:start_ms]] for transcript moments and [[cite:run_id:kind]] for non-seekable sources.",
      ].join("\n"),
    }
  );

  registerTools(server, {
    db: dbHandle.db,
    isVecAvailable: () => dbHandle.vecAvailable,
    ollamaBaseUrl: config.ollamaBaseUrl,
    runsRoot: config.runsRoot,
  });
  trace(`tools registered`);

  const { stopPolling } = registerResources(server, {
    db: dbHandle.db,
    runsRoot: config.runsRoot,
  });
  trace(`resources registered`);

  const transport = new StdioServerTransport();

  const cleanup = () => {
    try {
      stopPolling();
    } catch {}
    try {
      dbHandle.close();
    } catch {}
  };
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  process.on("exit", cleanup);

  await server.connect(transport);
  trace(`connected to stdio transport — waiting for client`);
}

// Catch unhandled errors at every level so they hit Claude Desktop's MCP
// log via stderr instead of dying silently.
process.on("uncaughtException", (err) => {
  trace(`uncaughtException: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  trace(`unhandledRejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
  process.exit(1);
});

main().catch((err) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  trace(`fatal: ${message}`);
  process.exit(1);
});
