# Gistlist for Claude Desktop — Setup

Gistlist ships a Claude Desktop extension that lets Claude search and read your meetings — full transcripts, summaries, prep, and notes — without your data ever leaving your Mac. This page walks through installing it.

> **Public docs note:** when this lives on the marketing site, swap in screenshots for each step. Path: `gistlist.app/docs/claude-desktop-setup`.

---

## Prerequisites

- **macOS 12 or later.** Windows support follows whenever the Gistlist app itself ships a Windows build.
- **Claude Desktop installed.** If you don't have it: download from [claude.com/download](https://claude.com/download). Open it once so it can register itself as the handler for `.mcpb` extension files.
- **Gistlist installed**, with at least one recorded meeting. The integration reads from your local `~/.gistlist/meetings.db`.
- **Ollama running** (optional but recommended). The MCP server uses Ollama for semantic search embeddings. Without it, search degrades cleanly to keyword-only.

---

## Install (two clicks)

1. **In Gistlist**, open **Settings → Integrations** and click **Install Gistlist for Claude Desktop**.
2. **In Claude Desktop**, the install review pane appears. Confirm the config (the default `~/.gistlist` is correct for everyone) and click **Install**.

Done. The Gistlist tools are now available in every Claude conversation, and your meetings appear in Claude's `@`-mention picker.

> If the install button in Gistlist shows a "Couldn't open Gistlist.mcpb" error, jump to [Troubleshooting](#troubleshooting).

---

## Verify the install

In Claude Desktop:

- **Settings → Extensions** should list **Gistlist**, enabled.
- In a conversation, type `@gistlist` — you should see your meetings listed in the picker.
- Or just ask Claude something — it will call the appropriate Gistlist tool automatically:

```
What did I discuss with Lauren last week?
```

Claude should call `search_meetings` (or `list_recent_meetings`), then `get_meeting` on the relevant `run_id`, and answer from the full transcript with citations.

---

## What Claude can do with it

Three tools, all read-only:

| Tool | When Claude picks it |
|---|---|
| `list_recent_meetings(limit?, status?, date_from?, date_to?, participant?)` | Structured queries — *"meetings with Clara last week"*, *"what's on my calendar tomorrow"*. |
| `search_meetings(query, ...)` | Semantic / keyword discovery — *"find moments where I talked about pricing"*. Returns brief snippets + meeting `run_id`s for routing. |
| `get_meeting(run_id, sections?)` | Full transcript pull — Claude calls this on the candidates from search/list to actually answer. The default body is `notes → transcript → prep → summary`, with the auto-generated summary clearly labeled (and demoted) so Claude prefers the raw transcript for nuanced questions. |

Plus: every meeting is exposed as a **resource** at `meeting://<run_id>`. That's how `@gistlist` mentions work in Claude Desktop's picker.

---

## Privacy

- **No outbound network**, except to your local Ollama at `127.0.0.1:11434` (only when Claude calls `search_meetings` and you have Ollama running).
- **Read-only** access to `meetings.db` and your runs folder.
- **The Gistlist app does NOT need to be running.** Claude Desktop spawns the Gistlist MCP server as its own subprocess on demand.
- **No telemetry.** No accounts. No cloud sync.

---

## Troubleshooting

### "Couldn't open Gistlist.mcpb in Claude Desktop"

Most common cause: Claude Desktop isn't installed (or hasn't been opened at least once). Install Claude Desktop, open it once, then retry.

If Claude Desktop is installed and the button still does nothing, try opening the bundled file directly: in Gistlist's Settings → Integrations the button calls `open` on `Gistlist.mcpb` inside the app bundle. You can also open it manually from a terminal:

```sh
open "/Applications/Gistlist.app/Contents/Resources/mcp/Gistlist.mcpb"
```

### Extension installed but no Gistlist tools in Claude

- Restart Claude Desktop.
- In Claude Desktop → Settings → Extensions, confirm **Gistlist** is toggled on.

### "No meetings found" responses

- Confirm Gistlist has at least one recorded and processed meeting.
- In Gistlist's Settings → Integrations, the **Library** status row should say "N meetings indexed" with N > 0.
- If the count is 0 even though you have meetings, open Gistlist's chat once — the indexing runs in the background and the chat surface kicks off the backfill if needed.

### Searches feel weak / Claude misses obvious matches

- Check Settings → Integrations → **Semantic search** status. If it says "Ollama not running — keyword search only," start Ollama (`ollama serve`).
- Confirm Ollama has the `nomic-embed-text` model pulled. Settings → Chat → Embedding model should report it as installed; if not, the page has a one-click install.

### Manual install (advanced)

If the one-click install doesn't work, you can register the MCP server by editing Claude Desktop's config file at `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gistlist": {
      "command": "node",
      "args": [
        "/Applications/Gistlist.app/Contents/Resources/mcp/Gistlist.mcpb/server.js"
      ],
      "env": {
        "GISTLIST_CONFIG_DIR": "~/.gistlist",
        "OLLAMA_BASE_URL": "http://127.0.0.1:11434",
        "NODE_PATH": "/Applications/Gistlist.app/Contents/Resources/mcp/Gistlist.mcpb/node_modules"
      }
    }
  }
}
```

Restart Claude Desktop.

---

## Uninstall

In Claude Desktop: Settings → Extensions → click the menu next to Gistlist → **Remove**. No leftover state — Gistlist's own data (meetings.db, runs folder) is untouched.

---

## What's not here

- **ChatGPT.** ChatGPT's MCP support requires a public HTTPS endpoint with OAuth, which is incompatible with Gistlist's local-first design. We're keeping watch — if OpenAI adds a local-spawn path like Anthropic's `.mcpb`, we'll add ChatGPT support.
- **Claude on the web (claude.ai).** Web Claude only supports remote connectors, same constraints as ChatGPT.
- **Claude on mobile.** No MCP extension API.

Claude Desktop is the only surface that supports a local-spawn integration, which is why it's the only one we ship for.
