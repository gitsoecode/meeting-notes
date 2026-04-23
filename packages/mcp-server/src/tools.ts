/**
 * Three MCP tools wired to the lifted engine retrieval. Tool descriptions
 * actively teach Claude the discovery → full-read pattern: search returns
 * thin routing snippets + run_ids, get_meeting is the answering path.
 *
 * Implementation note: input schemas are typed as `Record<string, z.ZodTypeAny>`
 * to keep TypeScript's generic inference shallow inside `registerTool` —
 * inferring nested ShapeOutput across multiple schemas blows the inference
 * depth limit (TS2589). Handler args are validated at runtime by the SDK
 * against the same schemas, so we lose nothing in correctness.
 */
import type Database from "better-sqlite3";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  searchMeetings as engineSearchMeetings,
  listMeetings as engineListMeetings,
  type RetrievalTrace,
} from "@gistlist/engine/core/chat-index/retrieve.js";
import {
  createOllamaEmbedder,
  DEFAULT_EMBEDDING_MODEL,
} from "@gistlist/engine/core/chat-index/embed.js";
import {
  assembleMeetingBody,
  loadMeetingRow,
  type MeetingSection,
  DEFAULT_SECTION_ORDER,
} from "./meeting-body.js";

export interface ToolContext {
  db: Database.Database;
  isVecAvailable: () => boolean;
  ollamaBaseUrl: string;
  runsRoot: string;
}

const SEARCH_DEFAULT_LIMIT = 8;
const LIST_DEFAULT_LIMIT = 25;
/**
 * Trim each search snippet to ~600 chars. Deliberately narrow (matching the
 * app Chat pill UX) so Claude is nudged toward calling `get_meeting` for the
 * full transcript rather than synthesizing from the snippet. Wide snippets
 * would teach the wrong pattern.
 */
const SEARCH_SNIPPET_MAX_CHARS = 600;

type Status = "past" | "upcoming" | "any";

interface ListArgs {
  limit?: number;
  status?: Status;
  participant?: string;
  date_from?: string;
  date_to?: string;
}

interface SearchArgs {
  query: string;
  limit?: number;
  status?: Status;
  participant?: string;
  date_from?: string;
  date_to?: string;
}

interface GetMeetingArgs {
  run_id: string;
  sections?: MeetingSection[];
}

const listInputSchema: Record<string, z.ZodTypeAny> = {
  limit: z
    .number()
    .int()
    .positive()
    .max(200)
    .optional()
    .describe("Max meetings to return. Default 25."),
  status: z
    .enum(["past", "upcoming", "any"])
    .optional()
    .describe(
      'Filter by status. "past" excludes meetings scheduled in the future; "upcoming" only those. Default "any".'
    ),
  participant: z
    .string()
    .optional()
    .describe(
      "Filter by participant name. Falls back to a meeting-title match if the participants table is empty for a run."
    ),
  date_from: z
    .string()
    .optional()
    .describe("Inclusive lower bound, ISO date YYYY-MM-DD. Pair with date_to."),
  date_to: z
    .string()
    .optional()
    .describe("Inclusive upper bound, ISO date YYYY-MM-DD. Pair with date_from."),
};

const searchInputSchema: Record<string, z.ZodTypeAny> = {
  query: z.string().min(1).describe("Free-text search query."),
  limit: z
    .number()
    .int()
    .positive()
    .max(50)
    .optional()
    .describe("Max search hits to return. Default 8."),
  status: z
    .enum(["past", "upcoming", "any"])
    .optional()
    .describe('Filter by run status. Default "any".'),
  participant: z
    .string()
    .optional()
    .describe(
      "Filter by participant name. Falls back to title match when participants table is empty for a run."
    ),
  date_from: z
    .string()
    .optional()
    .describe("Inclusive lower bound, ISO date YYYY-MM-DD. Pair with date_to."),
  date_to: z
    .string()
    .optional()
    .describe("Inclusive upper bound, ISO date YYYY-MM-DD. Pair with date_from."),
};

const getMeetingInputSchema: Record<string, z.ZodTypeAny> = {
  run_id: z.string().min(1).describe("The run_id from a search/list result."),
  sections: z
    .array(z.enum(["notes", "transcript", "prep", "summary"]))
    .optional()
    .describe(
      "Subset of sections to include. Defaults to all (notes, transcript, prep, summary). Useful for token-tight multi-meeting pulls — e.g. ['transcript', 'notes'] skips the auto-summary."
    ),
};

export function registerTools(server: McpServer, ctx: ToolContext): void {
  registerListRecentMeetings(server, ctx);
  registerSearchMeetings(server, ctx);
  registerGetMeeting(server, ctx);
}

/**
 * Bypass SDK's registerTool generic inference. The SDK's `ToolCallback<Args>`
 * conditional type recurses through ShapeOutput → SchemaOutput across both
 * zod v3 and v4 type spaces, which TypeScript can't resolve in a single
 * compilation unit when several tools are registered together (TS2589).
 * Runtime validation still happens inside the SDK against `inputSchema`.
 */
interface SafeToolConfig {
  title: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
}
type SafeToolHandler = (args: unknown) => Promise<CallToolResult>;
type SafeRegisterTool = (
  name: string,
  config: SafeToolConfig,
  handler: SafeToolHandler
) => unknown;

function registerToolSafe(
  server: McpServer,
  name: string,
  config: SafeToolConfig,
  handler: SafeToolHandler
): void {
  (server.registerTool as unknown as SafeRegisterTool)(name, config, handler);
}

function registerListRecentMeetings(server: McpServer, ctx: ToolContext): void {
  registerToolSafe(
    server,
    "list_recent_meetings",
    {
      title: "List recent meetings",
      description: [
        "Lists meetings filtered by participant, date range, or status.",
        "Use this for structured questions about who you met with or when —",
        "no semantic search is needed for 'meetings with X' or 'meetings last week'.",
        "",
        "For questions about how something changed over time, list the relevant meetings first,",
        "then call `get_meeting(run_id)` on each in chronological order and narrate the change",
        "across them. The full transcripts are where the answer lives — the metadata returned",
        "here is just for routing.",
      ].join("\n"),
      inputSchema: listInputSchema,
    },
    async (rawArgs) => {
      const args = rawArgs as ListArgs;
      const meetings = engineListMeetings(
        ctx.db,
        {
          status: args.status,
          participant: args.participant,
          date_range: dateRangeFromArgs(args.date_from, args.date_to),
        },
        args.limit ?? LIST_DEFAULT_LIMIT
      );
      const payload = {
        meetings: meetings.map((m) => ({
          run_id: m.run_id,
          title: m.run_title,
          date: m.run_date,
          status: m.run_status,
          participants: m.participants,
          resource_uri: `meeting://${m.run_id}`,
        })),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    }
  );
}

function registerSearchMeetings(server: McpServer, ctx: ToolContext): void {
  registerToolSafe(
    server,
    "search_meetings",
    {
      title: "Search meeting content",
      description: [
        "Searches meeting content using hybrid keyword + semantic retrieval.",
        "Returns the top candidate meetings with brief snippets and stable",
        "[[cite:run_id:start_ms]] anchors.",
        "",
        "IMPORTANT: the snippets are for verifying relevance, NOT for answering.",
        "To actually answer the user's question, call `get_meeting(run_id)` on the",
        "top candidates and reason from the full transcript. For questions spanning",
        "multiple meetings (e.g. 'how did our thinking on X change'), call",
        "`get_meeting` on several relevant meetings in chronological order.",
      ].join("\n"),
      inputSchema: searchInputSchema,
    },
    async (rawArgs) => {
      const args = rawArgs as SearchArgs;
      const embedder = createOllamaEmbedder({
        baseUrl: ctx.ollamaBaseUrl,
        model: DEFAULT_EMBEDDING_MODEL,
      });
      const queryEmbedder = async (q: string): Promise<number[] | null> => {
        try {
          const vecs = await embedder([q]);
          return vecs[0] ?? null;
        } catch {
          // Ollama unreachable / model missing → quietly fall back to FTS-only.
          return null;
        }
      };

      // Default the trace to "vec unavailable" so TS narrows properly in the
      // mode-picking chain below; the callback updates it synchronously from
      // inside engineSearchMeetings before control returns here.
      const trace: RetrievalTrace = {
        vecAvailable: false,
        embedderRan: false,
        vecLegRan: false,
      };
      const results = await engineSearchMeetings(ctx.db, args.query, {
        limit: args.limit ?? SEARCH_DEFAULT_LIMIT,
        status: args.status,
        participant: args.participant,
        date_range: dateRangeFromArgs(args.date_from, args.date_to),
        queryEmbedder,
        isVecAvailable: ctx.isVecAvailable,
        onRetrievalTrace: (t) => {
          trace.vecAvailable = t.vecAvailable;
          trace.embedderRan = t.embedderRan;
          trace.vecLegRan = t.vecLegRan;
        },
      });

      // Honest retrieval_mode: "hybrid" only when both legs had a chance to
      // contribute. If vec is loaded but Ollama/embedder failed (or returned
      // nothing), flag it so Claude can compensate for degraded recall
      // instead of silently trusting an FTS-only result labeled "hybrid".
      let retrievalMode: "hybrid" | "fts_only" | "fts_only_embedder_failed";
      if (!trace.vecAvailable) retrievalMode = "fts_only";
      else if (!trace.embedderRan) retrievalMode = "fts_only_embedder_failed";
      else retrievalMode = "hybrid";

      const payload = {
        query_echo: args.query,
        retrieval_mode: retrievalMode,
        results: results.map((r) => ({
          run_id: r.run_id,
          title: r.run_title,
          date: r.run_date,
          status: r.run_status,
          participants: r.participants,
          kind: r.kind,
          speaker: r.speaker,
          start_ms: r.start_ms,
          snippet: clampSnippet(r.snippet),
          citation:
            r.start_ms != null
              ? `[[cite:${r.run_id}:${r.start_ms}]]`
              : `[[cite:${r.run_id}:${r.kind}]]`,
          resource_uri: `meeting://${r.run_id}`,
        })),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    }
  );
}

function registerGetMeeting(server: McpServer, ctx: ToolContext): void {
  registerToolSafe(
    server,
    "get_meeting",
    {
      title: "Get full meeting markdown",
      description: [
        "Returns the full markdown body for one meeting — notes, raw transcript,",
        "prep, and the auto-generated summary, in that order. The transcript is",
        "the ground truth; the auto-summary is labeled as auto-generated and",
        "may miss threads, so prefer the transcript for nuanced questions.",
        "",
        "Use this as the primary answering path: after `search_meetings` or",
        "`list_recent_meetings` returns candidate run_ids, call this on each",
        "and reason from the full content.",
      ].join("\n"),
      inputSchema: getMeetingInputSchema,
    },
    async (rawArgs) => {
      const args = rawArgs as GetMeetingArgs;
      const row = loadMeetingRow(ctx.db, args.run_id);
      if (!row) {
        const errPayload = {
          error: `No meeting found with run_id "${args.run_id}".`,
        };
        return {
          isError: true,
          content: [{ type: "text", text: errPayload.error }],
          structuredContent: errPayload,
        };
      }
      const sections = (args.sections ?? DEFAULT_SECTION_ORDER) as MeetingSection[];
      let body;
      try {
        body = assembleMeetingBody(row, { runsRoot: ctx.runsRoot, sections });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: message }],
          structuredContent: { error: message },
        };
      }
      return {
        content: [{ type: "text", text: body.body_md }],
        structuredContent: {
          run_id: body.run_id,
          title: body.title,
          date: body.date,
          participants: body.participants,
          duration_minutes: body.duration_minutes,
          body_md: body.body_md,
          sections_included: body.sections_included,
        },
      };
    }
  );
}

function clampSnippet(s: string): string {
  if (s.length <= SEARCH_SNIPPET_MAX_CHARS) return s;
  return s.slice(0, SEARCH_SNIPPET_MAX_CHARS) + "…";
}

function dateRangeFromArgs(
  from: string | undefined,
  to: string | undefined
): { from: string; to: string } | undefined {
  if (!from || !to) return undefined;
  return { from, to };
}
