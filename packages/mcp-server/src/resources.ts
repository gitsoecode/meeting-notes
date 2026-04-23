/**
 * `meeting://<run_id>` resources. Each meeting is exposed as an MCP
 * resource so Claude Desktop's @-mention picker shows the user's meetings
 * alongside Google Docs etc. Resource content is the full assembled
 * markdown — same as `get_meeting` returns.
 *
 * `listChanged` polling uses a composite (count, max(updated_at))
 * fingerprint over the runs table; see db.ts:runsListFingerprint.
 */
import type Database from "better-sqlite3";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assembleMeetingBody, loadMeetingRow } from "./meeting-body.js";
import { runsListFingerprint } from "./db.js";

export interface ResourceContext {
  db: Database.Database;
  runsRoot: string;
}

const POLL_INTERVAL_MS = 5_000;

export function registerResources(
  server: McpServer,
  ctx: ResourceContext
): { stopPolling: () => void } {
  const template = new ResourceTemplate("meeting://{run_id}", {
    list: async () => {
      const rows = ctx.db
        .prepare(
          `SELECT run_id, title, date FROM runs ORDER BY date DESC LIMIT 1000`
        )
        .all() as Array<{ run_id: string; title: string; date: string }>;
      return {
        resources: rows.map((r) => ({
          uri: `meeting://${r.run_id}`,
          name: `${r.title} — ${r.date}`,
          mimeType: "text/markdown",
          description: `Gistlist meeting recorded on ${r.date}`,
        })),
      };
    },
  });

  server.registerResource(
    "meeting",
    template,
    {
      description:
        "A Gistlist meeting — full markdown body assembled from notes, transcript, prep, and auto-summary.",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const runId = String(variables.run_id ?? "");
      if (!runId) {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "text/plain",
              text: "Invalid meeting URI: missing run_id.",
            },
          ],
        };
      }
      const row = loadMeetingRow(ctx.db, runId);
      if (!row) {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "text/plain",
              text: `No meeting found for run_id "${runId}".`,
            },
          ],
        };
      }
      try {
        const body = assembleMeetingBody(row, { runsRoot: ctx.runsRoot });
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "text/markdown",
              text: body.body_md,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "text/plain",
              text: message,
            },
          ],
        };
      }
    }
  );

  // Poll the runs list for adds/deletes so the @-mention picker stays
  // in sync with new meetings the user records.
  let lastFingerprint = runsListFingerprint(ctx.db);
  const interval = setInterval(() => {
    try {
      const next = runsListFingerprint(ctx.db);
      if (next !== lastFingerprint) {
        lastFingerprint = next;
        if (server.isConnected()) server.sendResourceListChanged();
      }
    } catch {
      // Polling errors are non-fatal — we'll catch the next tick.
    }
  }, POLL_INTERVAL_MS);
  // Don't keep the process alive solely for this timer.
  if (typeof interval.unref === "function") interval.unref();

  return { stopPolling: () => clearInterval(interval) };
}
