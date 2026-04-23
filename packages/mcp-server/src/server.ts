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
const SERVER_VERSION = "0.1.0";

async function main(): Promise<void> {
  const config = resolveConfig();

  const dbHandle = await openMeetingsDb(config.dbPath);
  if (dbHandle.vecLoadError) {
    // Surface to stderr so Claude Desktop's logs capture it. Stdout is
    // reserved for the JSON-RPC stream over stdio.
    process.stderr.write(
      `[gistlist-mcp] sqlite-vec load failed (${dbHandle.vecLoadError}); falling back to FTS-only retrieval.\n`
    );
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

  const { stopPolling } = registerResources(server, {
    db: dbHandle.db,
    runsRoot: config.runsRoot,
  });

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
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[gistlist-mcp] fatal: ${message}\n`);
  process.exit(1);
});
