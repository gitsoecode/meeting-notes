# Gistlist

> **Your meetings stay on your machine.**

A local-first desktop meeting workspace with editable markdown, local control, and customizable prompt-driven outputs. The Electron app is the primary product; the CLI is a secondary surface for power users. Gistlist records mic + system audio, transcribes locally (or via OpenAI), runs prompts over the transcript to produce structured notes, and keeps the resulting files on disk.

No account. No cloud sync. No telemetry.

---

## Features

- **Recording.** Mic + system audio, with pause/resume, live audio meters, and recovery for runs interrupted by quit or crash.
- **Transcription.** Fully local via Parakeet MLX (Apple Silicon) or whisper.cpp, or cloud via OpenAI. Swap providers in Settings.
- **Prompt pipeline.** One default summary plus any number of user-defined prompts that run in parallel over the transcript. Outputs stream with live per-section progress.
- **Ask questions across your meetings.** Gistlist ships an MCP server that Claude Desktop spawns locally. Ask Claude anything about your library and it returns retrieval-grounded answers with click-to-seek audio citations — clicking a citation opens Gistlist at the exact transcript moment. See [docs/mcp-setup.md](docs/mcp-setup.md).
- **Meeting prep.** A pre-meeting notes surface for staging context and prompts before a call.
- **LLM provider.** Claude (cloud), OpenAI (cloud), or Ollama (fully local). Ollama is bundled in packaged macOS builds — no separate install required. Individual prompts can override the global provider, so you can mix (e.g. local for most prompts, Claude for one specific summary).
- **Obsidian (optional).** Writes editable markdown into a vault, with a Dataview-powered dashboard for browsing runs.
- **Native macOS posture.** Electron sandbox on by default, API keys in the macOS Keychain, no telemetry.

---

## Prerequisites

Install these before running anything:

- **Node ≥ 20**
- **ffmpeg** (`brew install ffmpeg`)
- **macOS 14.2+** for automatic system audio capture (older macOS records mic-only)
- **Python 3.12** (or 3.11) — only if you pick the `parakeet-mlx` ASR provider
- An **Anthropic API key** — only if you want Claude as an LLM provider. Leave blank for Ollama-only or OpenAI-only mode.
- An **OpenAI API key** — if you want OpenAI as an LLM provider, or if you pick the `openai` ASR provider (one key covers both).

Obsidian is optional. If you want the Dataview dashboard, install Obsidian and enable the Dataview plugin, then point Gistlist at your vault during setup.

---

## Run from source (desktop app)

These are source-build steps, not an end-user install. There is no signed `.dmg` release yet — you build locally and launch from the repo.

```bash
git clone <repo-url> ~/Projects/Meeting-notes
cd ~/Projects/Meeting-notes
npm install
npm run build
```

`npm run build` is required on a fresh checkout — `@gistlist/engine` exports from `./dist/index.js`, so downstream packages won't resolve until the engine has been built at least once.

### Launch the app

While actively developing, use the dev server — it watches the main process, preload, and renderer, and launches Electron against the live build:

```bash
npm run dev --workspace @gistlist/app
```

To launch an already-built copy without watchers:

```bash
npm run start --workspace @gistlist/app
```

### Package a `.app` for macOS

```bash
npm run package:mac --workspace @gistlist/app
```

This runs the app build, checks bundled binaries, and produces a packaged `.app` under `packages/app/release/`.

---

## First-run setup

On first launch the app opens an in-app **Setup Wizard**. Follow it to configure:

- LLM provider (Claude, Ollama, or a mix) and any required API keys
- ASR provider (`parakeet-mlx` | `openai` | `whisper-local`) and microphone
- Optional: Obsidian vault path and base folder for markdown outputs
- Optional: installing the local Parakeet Python environment (the wizard runs this for you — no Homebrew needed)

API keys go into the macOS Keychain under the service name `gistlist`. Config is written to `~/.gistlist/config.yaml`. If you chose an Obsidian vault, the wizard bootstraps `Meetings/Runs/`, `Meetings/Config/`, `Meetings/Templates/`, a `Dashboard.md`, a notes template, and `Config/pipeline.json`.

You can re-open Settings at any time to switch providers, rotate keys, or change the ASR engine.

---

## LLM provider: cloud or local

Gistlist can summarize meetings with **Anthropic Claude** (cloud, fastest, costs API credits), **OpenAI** (cloud, costs API credits), or a **local LLM via Ollama** (free, fully offline, slower per section). You can switch providers in **Settings → LLM** at any time, and individual prompts can override the default — useful if you want most outputs local but one specific prompt to hit Claude or OpenAI.

### Local mode (Ollama)

In development, Gistlist will prefer a system `ollama` on `PATH` if you already have one installed. For packaged macOS releases, we bundle the Ollama binary into the `.app` so end users don't need to install anything separately. On startup, Gistlist will:

1. **Reuse a system Ollama daemon** if one is already running on `localhost:11434`. We just talk to it — no second daemon, no duplicate models.
2. Otherwise, **spawn a daemon ourselves** — preferring a system `ollama` binary on `PATH` if one exists, falling back to the bundled binary in packaged builds — and stop it cleanly when you quit.

Models live in the standard `~/.ollama/models` directory regardless of which daemon ends up serving them. That means any models you've already pulled with Ollama are picked up automatically with **no duplicate downloads**, and anything you pull from inside Gistlist is also visible to a system Ollama install if you ever set one up.

**Picking a model.** The Settings → LLM dropdown lists a curated set of models chosen for transcript-style work (action items, structured outputs, agentic prompts). Defaults are filtered by your machine's RAM:

| Model | Size | Min RAM |
| --- | --- | --- |
| Qwen 3.5 9B *(recommended)* | ~5.5 GB | 16 GB |
| Gemma 4 E4B | ~4 GB | 16 GB |
| Qwen 3 8B | ~5 GB | 16 GB |
| Gemma 3 12B | ~7.5 GB | 24 GB |

The **Custom…** option lets you type any tag from [ollama.com/library](https://ollama.com/library), so you're not locked into the curated list — useful when a new model drops between releases.

**Speed expectations.** On a 16 GB Apple Silicon machine, a typical 30-minute meeting summary takes 30 s – 2 min per prompt with a 7B–9B model. The Meeting Detail page shows a live spinner and elapsed-seconds counter for each running section, plus a "Running locally" hint after 20 s, so you can see something is happening even on long sections.

**Cloud API keys.** When you run in local-only mode you don't need a Claude or OpenAI key at all — leave those fields blank in the wizard and in Settings. You can add either key later if you want a specific prompt to use a cloud model.

### Local mode (Parakeet, transcription)

Transcription is a separate path. Gistlist uses **Parakeet** (Apple Silicon MLX) for fully local transcription. Parakeet is installed during the Setup Wizard's dependencies step into a Python venv at `~/.gistlist/parakeet-venv` — the wizard handles this end-to-end, no Homebrew needed. If you'd rather use OpenAI's cloud transcription instead, switch the provider in **Settings → Transcription**.

---

## Asking questions across your meetings (Claude Desktop + MCP)

Gistlist ships an MCP server — a small stdio subprocess that Claude Desktop spawns locally. Once installed, you can ask Claude anything about your library ("what did Lauren say about pricing last month?", "summarize my 1:1s with Alex this quarter") and it returns retrieval-grounded answers with clickable audio citations.

- **Install:** Settings → Integrations → Claude Desktop. One click; Gistlist writes the Claude Desktop config. Restart Claude.
- **Private by default:** the MCP server is read-only over your local `meetings.db` and only talks to Ollama at `localhost:11434` for semantic search. No outbound network.
- **Citations:** every reply contains links of the form `https://gistlist.app/open?m=...&t=...` — clicking one opens Gistlist at the exact transcript moment.

What it needs to retrieve well:

- The same Ollama daemon Gistlist already uses for local LLMs.
- The **`nomic-embed-text`** embedding model (~274 MB). Pulled automatically on first launch and also surfaced in **Settings → Meeting index → Meeting-index embedding model**.

If `sqlite-vec` (the native extension that powers vector search) fails to load — or if the embedding model isn't installed — MCP degrades to keyword search only. It doesn't crash. You'll lose paraphrase recall (asking about "rates" won't hit a transcript that said "pricing") but literal matches still work.

### How indexing works

- Every completed or reprocessed meeting is indexed immediately into an FTS5 + vector index inside `~/.gistlist/meetings.db`.
- Pre-existing meetings are indexed in the background via **Settings → Meeting index → Re-run indexing**.

### Settings → Meeting index

- **Meeting-index embedding model** — status + Install button
- **Re-run indexing** — rebuilds the index over every meeting.

See [docs/mcp-setup.md](docs/mcp-setup.md) for detailed setup, troubleshooting, and the manual-config fallback.

---

## Obsidian integration (optional)

Gistlist can write each run's markdown into an Obsidian vault so the notes are editable in the tool you already use for writing. This is entirely optional — the app is fully functional without Obsidian.

If you want it:

1. Install Obsidian and enable the **Dataview** community plugin.
2. In the Setup Wizard (or **Settings → Obsidian**), enable the integration and point it at your vault and a base folder (defaults: `~/Obsidian/My-Vault` and `Meetings`).
3. Open `Meetings/Dashboard.md` in Obsidian — Dataview renders the run index.

The vault gets `Meetings/Runs/`, `Meetings/Config/`, `Meetings/Templates/`, `Dashboard.md`, a notes template, and `Config/pipeline.json`. The app treats these as its source of truth for that vault — edit the templates or pipeline config in place and Gistlist picks up the changes.

---

## CLI (advanced / secondary)

> The CLI lags behind the desktop app and doesn't support meeting prep, live prompt streaming, or the Claude Desktop MCP integration. New users should use the desktop app. The CLI is here for scripting, headless environments, and a few maintenance commands that aren't surfaced in the UI yet.

To use it, build and symlink from the repo root:

```bash
npm run build
npm link
gistlist --help
```

After `npm link`, the `gistlist` command is on your `PATH`. You only need to re-run `npm link` if you delete `dist/`/`node_modules`, change the `bin` entry in `package.json`, or move the project directory.

### Commands

| Command | What it does |
| --- | --- |
| `gistlist init` | First-time setup wizard (CLI alternative to the in-app wizard) |
| `gistlist set-key <claude\|openai>` | Add or rotate an API key in the Keychain |
| `gistlist setup-asr` | Install the local Parakeet ASR engine |
| `gistlist start [-t "Title"]` | Start a recording (title defaults to "Untitled Meeting") |
| `gistlist stop` | Stop the active recording and process it |
| `gistlist status` | Show recording status |
| `gistlist process <audio-file>` | Process an existing audio file |
| `gistlist reprocess <run-path>` | Re-run processing on an existing run |
| `gistlist logs [run-path]` | Show app or run logs |
| `gistlist test-audio` | Test audio capture from configured devices |
| `gistlist prompts list` | List configured pipeline prompts |
| `gistlist prompts path [id]` | Print the on-disk path of a prompt |
| `gistlist prompts new <id>` | Create a new prompt from the default template |
| `gistlist prompts enable\|disable <id>` | Toggle whether a prompt is active |
| `gistlist prompts auto\|manual <id>` | Toggle autorun vs manual-only |
| `gistlist prompts run <id> <run-path>` | Run a single prompt against an existing run |
| `gistlist prompts reset [id]` | Reset a builtin prompt to its shipped default |
| `gistlist config get` | Print the resolved config |
| `gistlist config set-data-path <path>` | Change where runs and app state are stored |
| `gistlist obsidian enable\|disable` | Toggle the Obsidian integration |
| `gistlist obsidian set-vault <vaultPath>` | Point the integration at a vault |

Run `gistlist --help` or `gistlist <command> --help` for full options on any command.

### Audio testing

```bash
gistlist test-audio
gistlist test-audio --duration 6000   # 6-second test (default 4s)
```

Records a short clip from each configured device, analyzes volume, and reports whether each device is found, capturing audio, and not silent.

---

## Testing

For the full list of test commands and when to use each, see the **Testing** section in [AGENTS.md](./AGENTS.md). That's the source of truth — the table covers `npm test`, the Playwright suites (full, fast, focused, live-Electron), and the native-module rebuild dance required when switching between the Node test runtime and the Electron runtime.

---

## Where things live

| What | Where |
| --- | --- |
| Config | `~/.gistlist/config.yaml` |
| App log | `~/.gistlist/app.log` |
| Parakeet venv | `~/.gistlist/parakeet-venv/` |
| API keys | macOS Keychain, service `gistlist` |
| Recordings & notes | `{vault_path}/{base_folder}/Runs/` |
| Pipeline config | `{vault_path}/{base_folder}/Config/pipeline.json` |
| Templates | `{vault_path}/{base_folder}/Templates/` |
| Dashboard | `{vault_path}/{base_folder}/Dashboard.md` |
| Meeting index (FTS + vectors) | `~/.gistlist/meetings.db` (`chat_chunks`, `chat_chunks_fts`, `chat_chunks_vec`) |

---

## Troubleshooting

**`gistlist: command not found`**
The global symlink isn't in place. From the project directory: `npm run build && npm link`.

**`Config not found at ~/.gistlist/config.yaml`**
You haven't run setup yet. Launch the app and complete the Setup Wizard, or run `gistlist init`.

**`No Anthropic API key found in macOS Keychain`**
Open Settings in the app and add a key, or run `gistlist set-key claude`.

**Dashboard is empty in Obsidian**
Make sure the Dataview plugin is installed and enabled in Obsidian's community plugins.

**Stale behavior after editing code**
You forgot to rebuild. Run `npm run build`, or leave `npm run dev --workspace @gistlist/app` running in a terminal.

**`better-sqlite3` / `NODE_MODULE_VERSION` mismatch when starting the desktop app**
The native SQLite module was compiled for plain Node (likely by the test runner) instead of Electron. Rebuild it for the app runtime:

```bash
npm run rebuild:native --workspace @gistlist/app
```

Notes:

- `npm test` automatically rebuilds `better-sqlite3` for the current plain Node runtime first. That's expected for tests.
- The Electron app needs the Electron-targeted rebuild above if you see `ERR_DLOPEN_FAILED` or a `NODE_MODULE_VERSION` mismatch while launching, opening, or starting a meeting.
- You'll flip back and forth between these two builds as you move between test runs and app runs. That's expected — don't spend time debugging it, just run the appropriate rebuild for whichever runtime you need next.

---

## License

Gistlist is licensed under the [Functional Source License, Version 1.1, ALv2 Future License (FSL-1.1-ALv2)](./LICENSE). Copyright © 2026 Gistlist, LLC.

In short: you can read, use, modify, and redistribute this code for any purpose — **except** building a commercial product or service that competes with Gistlist. Internal use, non-commercial research, and education are explicitly allowed. Two years after each release, that code automatically converts to Apache 2.0.

This is **source-available** (sometimes called "fair source"), not OSI-approved open source.
