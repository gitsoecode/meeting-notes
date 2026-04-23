# Gistlist MCP Server — Plan (v2)

**Status:** Draft for review. Not yet started.
**Owner:** Jesse
**Last updated:** 2026-04-22
**Revision:** v2.2 — second-round agent review fixes: stronger list fingerprint, schema-accurate return shapes, macOS-only scope matching app, toast on install failure.

## Goal

Ship a Claude Desktop Extension (`.mcpb`) that lets users query their own local Gistlist meetings — full transcripts, summaries, prep, notes — from inside Claude Desktop using their existing Claude subscription. Distribution narrative: **"Gistlist works with Claude Desktop. Your meetings, queryable from Claude. Nothing leaves your machine."**

## Non-goals (v1)

- Write operations from Claude (creating/editing/deleting meetings).
- Cloud hosting, multi-user sync, OAuth, accounts.
- Claude mobile or claude.ai web (mobile has no extension API; web is remote-connector only).
- HTTP/SSE transport. Stdio only.
- Server-side LLM calls / `sampling/createMessage` (Claude Desktop support is unreliable as of 2026-04 — verify before relying on).
- Anthropic Connectors Directory submission (post-launch fast-follow).
- MCP Apps (interactive widgets) — interesting, but not critical path.
- **Pagination of `get_meeting` responses in v1** (see "Token strategy").
- **ChatGPT support.** See "Scope: Claude Desktop only" below.

---

## Scope: Claude Desktop only (no ChatGPT in v1)

**Decision:** ship exclusively for Claude Desktop. Do not build a ChatGPT-compatible variant. Revisit post-1.0 only if (a) OpenAI adds stdio / local-spawn MCP support, or (b) measurable customer demand justifies the architectural cost.

**Why:** ChatGPT's MCP support (Apps in ChatGPT, launched Oct 2025; Apps SDK, renamed Dec 2025) is architecturally incompatible with a local-first desktop app:

- **No stdio transport.** ChatGPT only connects to remote Streamable HTTP / SSE endpoints. No `.mcpb` equivalent, no local-subprocess pathway.
- **No localhost.** ChatGPT explicitly refuses `localhost` connections. A ChatGPT-compatible server must be reachable on the public internet over HTTPS.
- **OAuth 2.1 + Dynamic Client Registration required.** No API keys, service accounts, or machine-to-machine auth.

**What shipping ChatGPT support would cost:** ~2–3 weeks engineering for a v1 — rewrite transport to Streamable HTTP, bundle a tunnel client (Cloudflare Tunnel / ngrok) to expose localhost publicly, implement OAuth 2.1 + DCR + PKCE, run Gistlist as an always-on daemon (ChatGPT can connect anytime), build a different Settings flow, and submit to the ChatGPT App Directory for public distribution. Plus permanent ops complexity: public HTTPS attack surface, OAuth token management, tunnel dependency.

**Strategic framing:** ChatGPT's remote-only architecture is a **marketing asset for Gistlist**, not a gap to fill. Public copy: *"Gistlist runs entirely on your machine. Native integration with Claude Desktop because Claude can talk to local apps. We don't upload your meetings to anyone's servers."* Don't apologize for the asymmetry — lean into it.

**If OpenAI adds local-spawn MCP support later,** the existing Node server should port with ~2–3 days of packaging + install-UX work, similar to the Claude Desktop path.

---

## Load-bearing insight #1: reuse the retrieval stack

Gistlist already has a production-grade meeting retrieval system: SQLite + FTS5 + `sqlite-vec` + RRF merge + stable `(run_id, start_ms)` citations, used by the in-app Chat assistant. See [`docs/private_plans/chat-architecture.md`](../private_plans/chat-architecture.md).

The MCP server is **a second consumer of the same retrieval core**, not a parallel implementation. The original "markdown + frontmatter + gray-matter" proposal would discard FTS+vec hybrid retrieval and ship a weaker alternative — explicitly rejected.

## Load-bearing insight #2: discovery vs reasoning are separate jobs

Two distinct workloads:

1. **Discovery** — narrowing the candidate set of 500 meetings to 3–5 relevant `run_id`s. Ollama embeddings + FTS + structured filters do this fine. Small models are competitive with large models on embedding-based ranking.
2. **Reasoning** — once the right meetings are identified, **Claude reads the full transcripts** and synthesizes. Small models lose threads mid-transcript; Claude's long context window is exactly where this work belongs.

Implication: search results are **routing hints**, not answers. The default flow is `search` (or `list`) → pick run_ids → `get_meeting` for each → reason from full content. Multi-meeting reasoning ("what changed across my Clara meetings") is a first-class case.

This shapes tool output sizes and tool descriptions. See "Tools surface" below.

---

## Architecture

```
Claude Desktop
    │ stdio (spawns subprocess on demand, lifecycle independent of Gistlist app)
    ▼
packages/mcp-server/             ← NEW
    │ MCP TypeScript SDK
    │ stdio transport
    │ tools + resources
    ▼
packages/engine/src/core/        ← existing, lifted retrieval lives here
    chat-index/
        retrieve.ts (lifted)
        embed.ts (existing)
        chunk.ts (existing)
        ...
    config.ts (read existing config.yaml)
    ▼
better-sqlite3 (read-only)  →  meetings.db (under getConfigDir())
fs                          →  runs root (configured in config.yaml)
fetch                       →  http://localhost:11434  (Ollama, optional)
```

Key properties:

- **The Gistlist Electron app does NOT need to be running.** Claude Desktop spawns the MCP server subprocess directly. The MCP server reads `meetings.db` and the runs root from disk independently. The only time Gistlist needs to be open is when recording or processing new meetings.
- **Read-only access** to `meetings.db` and the runs root. No write surface. SQLite opened with `readonly: true`.
- **Graceful Ollama degradation.** If Ollama is down or `sqlite-vec` fails to load, the server falls back to FTS-only — same pattern Chat already inherits. Vector search is best-effort, not required.
- **No outbound network** beyond `localhost:11434`. No telemetry.

### Why a separate Node process and not Electron-embedded

Claude Desktop spawns its own subprocess over stdio. The MCP server has to be standalone. Bundling a Node entry point with the same engine code matches what `packages/cli/` already does.

---

## Config: single source of truth

**Don't** expose `meetings_db_path` directly — that lets the user point the DB at content that's mismatched with the runs root and bypasses the `run-access.ts` path guardrail.

**Do** expose a single `gistlist_config_dir` (defaults to `~/.gistlist/`). The MCP server reads `config.yaml` from there exactly the way the CLI and app do, and derives:
- DB path → `<configDir>/meetings.db`
- Runs root → from `config.yaml` (defaults to `~/Documents/Gistlist`)

This keeps a single source of truth and respects the existing path-validation guardrail. Run path validation in the MCP server uses the same helper as the app.

`user_config` in `manifest.json`:
- `gistlist_config_dir` (`directory` type, optional override) — default via `${HOME}/.gistlist/`.
- `ollama_url` (`string`, optional) — default `http://localhost:11434`.

---

## Tools surface

Three tools in v1. All wrappers over engine functions. Tool descriptions are not boilerplate — they actively teach Claude the discovery-then-full-read pattern.

### `list_recent_meetings(limit?, status?, date_range?, participant?)`

Cheap structured-filter listing. **The right tool for "meetings with X" / "meetings last week" / "what's on my calendar."**

Tool description (verbatim guidance to Claude):
> *"Lists meetings filtered by participant, date range, or status. Use this for structured questions about who you met with or when. For questions about how something changed over time, list the relevant meetings, then call `get_meeting` on each in chronological order and narrate the change across them."*

**Returns:**
```ts
{
  meetings: Array<{
    run_id: string;
    title: string;
    date: string;            // YYYY-MM-DD
    status: "past" | "upcoming";
    participants: string[];
    duration_minutes: number | null;   // matches schema's persisted field; no conversion
    resource_uri: string;     // "meeting://<run_id>"
  }>;
}
```

### `search_meetings(query, limit?, date_range?, participant?, status?)`

Hybrid FTS+vec+RRF search. **The right tool for semantic / keyword discovery.** Returns thin metadata + a routing snippet — not a full answer.

Tool description (verbatim guidance to Claude):
> *"Searches meeting content using semantic and keyword retrieval. Returns candidate meetings with brief snippets. The snippets are for verifying relevance, not for answering — to actually answer the user's question, call `get_meeting(run_id)` on the top candidates and reason from the full transcript. For questions spanning multiple meetings, call `get_meeting` on several."*

**Returns:**
```ts
{
  results: Array<{
    run_id: string;
    title: string;
    date: string;
    status: "past" | "upcoming";
    participants: string[];
    kind: "transcript" | "summary" | "prep" | "notes";
    speaker: string | null;
    start_ms: number | null;
    snippet: string;          // ~±300 chars — enough to verify relevance, NOT to answer
    citation: string;         // "[[cite:run_id:start_ms]]" or "[[cite:run_id:kind]]"
    resource_uri: string;     // "meeting://<run_id>"
  }>;
  query_echo: string;
}
```

**Diverges from earlier draft:** snippets are deliberately *narrow* (~±300, matching Chat's pill UX) so the response stays compact. Claude is nudged toward `get_meeting` rather than synthesizing from snippets. Wide snippets would teach the wrong pattern.

### `get_meeting(run_id, sections?)`

The **primary answering path.** Returns the full meeting markdown, ordered to put trustworthy raw content first and auto-generated content last.

Section ordering (default) — privileges raw transcript and user-authored content over Ollama-summarized content:

```
# {title} — {date}
_Participants: ..._
_Duration: ..._

## Notes (user-authored)
{notes.md if present}

## Transcript (raw)
{transcript.md — full, with speaker labels and timestamps, NO truncation}

## Prep (pre-meeting context)
{prep.md if present}

## Auto-generated summary
_Generated by the local summarization model; may miss threads. Prefer the transcript above for nuanced questions._
{summary.md if present}
```

Why this order: small models lose threads when summarizing. The auto-summary is convenient for gist questions but unreliable for nuanced ones. Putting the raw transcript first and labeling the auto-summary as such teaches Claude where to look for ground truth.

Optional `sections` argument lets Claude skip the summary on token-tight multi-meeting pulls: `get_meeting(run_id, sections: ['transcript', 'notes'])`.

**No pagination in v1.** If the assembled body exceeds Claude Desktop's tool-response cap, the call will visibly fail rather than silently truncate. Real-world meeting lengths suggest ~70–80% of meetings will fit in one response. We'll see where the real wall is from dogfooding before designing pagination.

**Returns** (`outputSchema`-typed):
```ts
{
  run_id: string;
  title: string;
  date: string;
  participants: string[];
  duration_minutes: number | null;   // matches runs.duration_minutes in schema
  body_md: string;           // full markdown, ordered as above
  sections_included: string[];
}
```

**Dropped from v1:** `has_audio`. Audio presence today is derived from run-folder file existence (`combined.wav`) or segment-level fields, not retrieval outputs — it's extra hydration work that doesn't earn its keep in the v1 answer flow. If Claude is reasoning over full transcripts with timestamps, whether audio exists is orthogonal. Add back in v1.1 if a concrete use case surfaces.

### Stretch (v1.1)

- `get_meeting_section(run_id, heading)` — sectioned fetch for very long meetings.
- `get_transcript_window(run_id, start_ms, window_ms)` — already exists in engine as `getTranscriptWindow`.

---

## Resources surface

Each meeting is exposed as an MCP Resource so Claude Desktop's `@`-mention picker shows them — same UX as @-mentioning a Google Doc in Claude.

- URI scheme: `meeting://<run_id>`
- MIME type: `text/markdown`
- `listChanged: true` — server emits `notifications/resources/list_changed` when the meetings list mutates. Detected by polling a composite fingerprint on a 5s timer: `(count(*), max(updated_at))` over the `runs` table. `max(updated_at)` alone is insufficient — a delete of any row that isn't the current max doesn't advance it. `count(*) + max(updated_at)` catches both additions and deletions in the common case. (A delete-plus-add within a single 5s window that produces the same count and the same max is theoretically possible but not worth designing around for v1; revisit with a per-row `(run_id, updated_at)` hash if dogfooding shows drift.)
- `subscribe: false` in v1 — content changes (transcript reprocess, notes edits) won't fire `notifications/resources/updated`. Resources refresh on read; v1 accepts the chance of a stale @-mention. Per-resource `updated` notifications deferred to v2 if dogfooding shows real friction.
- Resource content = same full assembled markdown as `get_meeting(run_id)` (default sections).
- Resource size handling: assumed to be more permissive than tool-response caps (resources are streamed into context). **This is an assumption to validate during Phase 2 dogfooding** — if Claude Desktop applies the same ~25K cap to resource reads, we revisit.

---

## Token strategy (v1: just let it rip)

Real-world meeting transcript tokens (timestamped, two-speaker):

| Meeting length | Approx tokens |
|---|---|
| 30 min | ~7–12K |
| 60 min | ~15–25K |
| 90 min | ~22–35K |
| 2 hr+ | 40K+ |

**v1 strategy:** no pagination, no truncation, no shortcuts. `get_meeting` returns full body. If Claude Desktop's response cap is hit, the call fails visibly. We learn the real ceiling from real use rather than guessing.

For multi-meeting reasoning (e.g., "what changed across my last 5 meetings with Clara"), Claude pulls 5 full transcripts → ~100K tokens of source material → fits comfortably in Sonnet 4.6's 200K window. Long-tail multi-meeting series (10+ meetings, 60+ min each) will hit context limits. Accept it; iterate post-launch.

Three pathways to full transcript content, layered:

| User intent | Pathway |
|---|---|
| "Find moments where I talked about pricing with Clara" | `search_meetings` → returns run_ids + thin snippets → Claude calls `get_meeting` on each → reasons from full content |
| "Summarize my Tuesday standup" (user `@`-mentions it in Claude) | Resource read → full markdown into context |
| Claude already knows the run_id | `get_meeting(run_id)` → full body |

---

## Install UX (the part users actually see)

**Assumption: user already has Claude Desktop installed.** No download prompts in the Gistlist UI. Public docs handle the "install Claude Desktop first" prerequisite for users who don't.

### What the user does

Two clicks total:

1. **In Gistlist:** Settings → Integrations → click **"Install Gistlist for Claude Desktop"**.
2. **In Claude Desktop:** the install review pane appears showing extension name, description, and the `gistlist_config_dir` config field (pre-populated). Click **Install**.

Done. The Gistlist tools (`search_meetings`, `get_meeting`, `list_recent_meetings`) are now available to Claude in any conversation. Meetings appear in Claude's `@`-mention picker as resources.

### What happens under the hood

1. The Gistlist app bundle ships `Gistlist.mcpb` inside `Resources/`.
2. On click, Gistlist calls `shell.openPath('/path/to/Gistlist.mcpb')`.
3. macOS routes the `.mcpb` file extension to its registered handler — Claude Desktop, which registered itself when *it* was installed.
4. Claude Desktop opens its built-in install review UI, validates the manifest signature, shows the user the requested capabilities and config form.
5. User clicks Install. Claude Desktop unpacks the `.mcpb` to its extensions directory and adds the entry to `claude_desktop_config.json`.
6. Claude Desktop spawns the MCP server on its next conversation that needs it (subprocess over stdio).

### What the Settings screen shows

Single Integrations row with:

- **Primary action:** "Install Gistlist for Claude Desktop" button. Click invokes `shell.openPath()` on the bundled `.mcpb`. If the call returns an error string (e.g., no registered handler for `.mcpb`), surface a toast: *"Couldn't open Gistlist.mcpb in Claude Desktop. See setup guide →"* with a link to the docs. No silent dead click.
- **Status indicator** (live, polled every 10s while the Settings page is open):
  - **Ollama:** "Ollama running — semantic search available" / "Ollama not running — keyword search only available."
  - **Meetings DB:** "12 meetings indexed" (info, not gating).
  - **Extension installed in Claude Desktop:** "Detected" / "Not detected." Detection by reading Claude Desktop's `claude_desktop_config.json` for our extension entry. If we can't reliably detect, fall back to "After installing in Claude Desktop, the extension will appear in Claude's Settings → Extensions."
- **Docs link:** "Setup guide & troubleshooting →" pointing at the public docs page.

No "download Claude Desktop" button. If the install button does nothing because Claude Desktop isn't installed, that's the user's setup issue, handled by the docs.

### Public setup docs (must exist before launch)

A page on the marketing site (or docs site) covering:

1. **Prerequisites** — Claude Desktop X.Y or later, macOS 12+ (Windows support follows the main app's platform support, not shipped in v1), Gistlist with at least one indexed meeting.
2. **Install steps** — exact two-click flow above with screenshots.
3. **Verifying the install** — open Claude Desktop, go to Settings → Extensions, look for "Gistlist." Try `@gistlist` in a conversation to attach a meeting.
4. **Using it** — three example prompts that demonstrate `list_recent_meetings`, `search_meetings`, and `@`-mention.
5. **Troubleshooting** — extension didn't appear / install button does nothing in Gistlist / "no meetings found" responses / Ollama not running.
6. **Privacy note** — repeat the local-first claims; the MCP server makes no outbound network calls.
7. **Uninstall** — remove from Claude Desktop's Extensions list. No state remains beyond what the user installed.

The Settings docs link goes to this page. Tracked as a launch deliverable.

### Failure modes named explicitly

| Symptom | Cause | What the user sees / does |
|---|---|---|
| Click shows "Couldn't open Gistlist.mcpb in Claude Desktop" toast with "See setup guide →" link | Claude Desktop not installed, or too old to handle `.mcpb` | Detected by checking `shell.openPath()`'s return value (empty on success, error string on failure) or by verifying `.mcpb` has a registered handler before opening. No silent dead click. Docs explain prerequisite. |
| Review pane appears but Install fails | `.mcpb` signature invalid (rare; we sign every release) | Docs explain; user redownloads Gistlist |
| Extension installed but no Gistlist tools in Claude | Claude Desktop needs restart, or extension disabled | Docs: restart Claude Desktop / check Extensions toggle |
| "No meetings found" | MCP server can't read DB or runs root | Docs: confirm Gistlist has recorded at least one meeting; check `gistlist_config_dir` in extension settings |
| Searches feel weak | Ollama not running → FTS-only fallback | Settings status indicator surfaces this; docs explain how to start Ollama |

---

## Refactor required (Phase 1)

Lift retrieval into the engine package.

**Today:** `packages/app/main/chat-index/retrieve.ts` exports `searchMeetings`, `getMeetingSummaryByRunId`, `getTranscriptWindow`, `listMeetings`. Depends on `getDb()` from `packages/app/main/db/connection.ts`.

**Target:**
- `packages/engine/src/core/chat-index/retrieve.ts` — pure logic, takes a `Database` handle as a parameter (no `getDb()` import).
- `packages/engine/src/core/chat-index/db-open.ts` — opens `meetings.db` read-only with the same pragmas the app uses.
- `packages/app/main/chat-index/retrieve.ts` becomes a thin app-side adapter that passes the app's singleton `getDb()` into the engine function. Public API and Chat behavior unchanged.
- `packages/mcp-server/` opens its own read-only handle.

**Native-module ownership:**
- `better-sqlite3` is currently in `packages/app` only. `packages/mcp-server/` declares its own dep on `better-sqlite3`.
- `sqlite-vec` is loaded as a runtime extension; the platform-specific `.so`/`.dylib`/`.dll` is bundled inside the `.mcpb`.
- Schema migrations stay owned by the app. The MCP server **never migrates**; it only reads. Schema-version mismatch → fail closed with a "please update Gistlist" tool response.

This is the load-bearing change. Everything else is mechanical.

---

## Build & packaging

- `packages/mcp-server/` builds via esbuild → `dist/server.js` (ES2022, target Node 20+).
- Native modules **cannot** be inlined into the JS bundle. They ship alongside as `.node` (better-sqlite3) and `.so/.dylib/.dll` (sqlite-vec) per platform.
- `manifest.json` (MCPB v0.3 schema):
  - `name: "gistlist"`, `display_name: "Gistlist"`
  - `version` matches Gistlist app version (locks DB schema compatibility)
  - `server.type: "node"`, `server.entry_point: "dist/server.js"`
  - `user_config` for `gistlist_config_dir` and `ollama_url`
  - `tools` and `resource_templates` declared
  - Icon and screenshots from existing brand assets
- `npm run pack:mcpb --workspace @gistlist/mcp-server` runs `mcpb pack` → emits `Gistlist.mcpb`.
- `mcpb sign` with the same Apple Developer ID cert used for the app.
- **Platform scope: macOS only in v1**, matching the app's current `package:mac`-only build target and "Download for macOS" marketing. Per-platform builds on CI: `mac-arm64` + `mac-x64`. Concatenate into one `.mcpb` containing both macOS binaries — Claude Desktop picks the right one at install. Windows bundles follow if/when the main app adds Windows support; tracked as out-of-scope for the MCP launch, not as a separate MCP workstream.
- `Gistlist.mcpb` copied into the app bundle's `Resources/` during `package:mac` / equivalent.

---

## Testing & release gates

Per AGENTS.md, this is non-negotiable:

| Phase | Required tests |
|---|---|
| Phase 1 (retrieval lift) | `npm test` (unit), `npm run test --workspace @gistlist/app` (chat retrieval still works), **`npm run test:e2e:electron --workspace @gistlist/app`** (touches main-process retrieval — required), `npm run test:e2e --workspace @gistlist/app`, `npm run rebuild:native --workspace @gistlist/app` after. |
| Phase 2 (MCP server core) | New unit tests in `packages/mcp-server/`. MCP integration tests via `@modelcontextprotocol/inspector`-style harness over stdio. `npm test` at repo root. |
| Phase 3 (`.mcpb` packaging) | Build artifact tests. `mcpb validate` on the output. Signature verification. Manual install in a clean Claude Desktop instance. |
| Phase 4 (Settings UI) | Full Playwright: `npm run test:e2e --workspace @gistlist/app`. Page-object updates for the new Integrations tab. `npm run rebuild:native` after. |
| Phase 5 (launch polish) | New `docs/private_plans/mcp-smoke-flow.md`: install, three canned queries, `@`-mention flow, uninstall. |

The `test:e2e:electron` gate in Phase 1 is the one that catches retrieval regressions a mock harness can't see — non-skippable.

---

## Privacy & security

- **No outbound network** beyond `localhost:11434` (Ollama). Document in manifest `long_description` and on the marketing page.
- **Read-only DB handle** — `better-sqlite3` opened with `readonly: true`.
- **Path validation** — refuse to read files outside the configured runs root (same pattern as `run-access.ts`).
- **No sandbox bypass** — Claude Desktop's bundled Node runs in user permission scope; standard FS access to `~/.gistlist/` and the runs root.

Pass through [`docs/private_plans/privacy-posture-analysis.md`](../private_plans/privacy-posture-analysis.md) before launch to confirm no regression.

---

## Open questions

1. **Resource `subscribe` for content updates.** Drop in v1 (current plan), or invest now in a file-watcher + `notifications/resources/updated`? Current vote: drop, revisit if dogfooding shows stale `@`-mentions are a real friction.
2. **Detection of installed extension** in Settings. Reading `claude_desktop_config.json` is brittle (path varies, format may change). Acceptable to ship a text-only "After installing in Claude Desktop, the extension will appear under Settings → Extensions" if detection is unreliable.
3. **Ollama UX when missing.** Surface FTS-only mode in tool responses (e.g., add a metadata field), or stay silent and rely on the Settings status indicator? Current vote: surface in the tool response so Claude can mention it if results feel weak.
4. **Versioning.** MCP server version locked to app version (current plan). Releases will need to ship both together.
5. **Resource size cap.** Verify in Phase 2 dogfooding whether Claude Desktop applies the ~25K tool-response cap to resource reads. If yes, the `@`-mention story degrades and we'll need a chunked-resource pattern.

---

## Phased delivery

### Phase 1 — Foundation (engine refactor)
- Lift `retrieve.ts` to `packages/engine/src/core/chat-index/`.
- Add `openMeetingsDbReadOnly()` helper.
- Update `packages/app/main/chat-index/retrieve.ts` to be a thin adapter; keep public API and Chat behavior unchanged.
- Tests: existing chat retrieval tests pass; new engine-level unit tests; `test:e2e:electron` to catch main-process regressions.
- **No user-visible change.**

### Phase 2 — MCP server core
- New workspace `packages/mcp-server/` with `@modelcontextprotocol/sdk`.
- Implement three tools using lifted retrieval.
- Implement `meeting://` resource scheme with `listChanged`.
- Tool descriptions explicitly teach the discovery → full-read pattern.
- Local testing via `@modelcontextprotocol/inspector`.
- Validate Claude Desktop resource-size handling.
- **Deliverable:** runnable MCP server, manually configurable in `claude_desktop_config.json`.

### Phase 3 — `.mcpb` packaging
- `manifest.json` with `user_config` for `gistlist_config_dir`.
- Per-platform native module bundling (mac-arm64 / mac-x64 / win-x64).
- `npm run pack:mcpb` script.
- Code-sign with `mcpb sign`.
- Bundle output into the app's `Resources/`.
- **Deliverable:** double-click-installable `Gistlist.mcpb`.

### Phase 4 — Settings UI
- "Integrations" tab in Settings → "Install Gistlist for Claude Desktop" row.
- Live status: Ollama, meetings DB count, extension detected.
- Manual-install fallback link.
- Public setup docs page.
- **Deliverable:** one-click install from Gistlist + complete documentation.

### Phase 5 — Launch polish
- Smoke flow documented in `docs/private_plans/mcp-smoke-flow.md`.
- Marketing copy updated (website + in-app).
- Submit to Anthropic Connectors Directory.
- **Deliverable:** shippable feature.

Estimate: Phase 1 is a half-day lift. Phases 2–4 each ~1–2 days. Phase 5 is a week of paperwork + iteration on directory feedback.

---

## References

- [`docs/private_plans/chat-architecture.md`](../private_plans/chat-architecture.md) — the retrieval system this plugs into.
- [`docs/private_plans/privacy-posture-analysis.md`](../private_plans/privacy-posture-analysis.md) — outbound-network audit; verify no regression.
- [`AGENTS.md`](../../AGENTS.md) — repo guardrails: scoped IPC, native-module rebuild, test gates.
- MCPB manifest spec: https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md
- MCPB CLI: https://github.com/modelcontextprotocol/mcpb/blob/main/CLI.md
- MCP spec 2025-11-25: https://modelcontextprotocol.io/specification/2025-11-25
- MCP Resources: https://modelcontextprotocol.io/specification/2025-11-25/server/resources
- MCP Tools: https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- Anthropic Desktop Extensions: https://www.anthropic.com/engineering/desktop-extensions
- Connectors Directory FAQ: https://support.claude.com/en/articles/11596036-anthropic-connectors-directory-faq
- Granola MCP (closest competitor pattern): https://www.granola.ai/blog/granola-mcp
