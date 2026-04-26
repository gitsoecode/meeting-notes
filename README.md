# Gistlist

> **Your meetings stay on your machine.**

A local-first desktop meeting workspace with editable markdown, local control, and customizable prompt-driven outputs. The Electron app is the primary product; the CLI is a secondary surface for power users. Gistlist records mic + system audio, transcribes it (locally on-device or via OpenAI), runs analysis prompts over the transcript on Claude / OpenAI / local Ollama to produce structured notes, and keeps the resulting files on disk.

No account. No cloud sync. No telemetry.

---

## Features

- **Recording.** Mic + system audio, with pause/resume, live audio meters, and recovery for runs interrupted by quit or crash.
- **Import.** Drop an existing audio or video file onto the Meetings page (or use the file picker) and Gistlist runs the same pipeline against it.
- **Transcription.** Fully local via Parakeet MLX (Apple Silicon) or whisper.cpp, or cloud via OpenAI. Swap providers in Settings.
- **Audio quality.** Gistlist reduces system-audio bleed in the mic track and drops near-duplicate speaker segments when the same audio appears in both channels, so the transcript reads cleanly.
- **Prompt pipeline.** One default summary plus any number of user-defined prompts that run in parallel over the transcript. Outputs stream with live per-section progress. Five extra prompt templates ship pre-installed and are one click away on the Analysis tab.
- **Ask questions across your meetings.** Gistlist ships an MCP server that Claude Desktop spawns locally. Ask Claude anything about your library and it returns retrieval-grounded answers with click-to-seek audio citations — clicking a citation opens Gistlist at the exact transcript moment. See [docs/mcp-setup.md](docs/mcp-setup.md).
- **Meeting prep.** A pre-meeting notes surface for staging context and prompts before a call.
- **Chat Launcher.** Send a meeting (or live transcript) to an external AI chat app with a configurable prompt template — completed-meeting, draft, and during-recording variants in Settings → Models.
- **Auto-update.** Gistlist checks for new releases and shows a banner when one is ready; nothing installs without your consent. Toggle in Settings → Other → Updates.
- **LLM provider.** Claude (cloud), OpenAI (cloud), or Ollama (fully local). If you pick local mode and don't already have Ollama installed, the Setup Wizard downloads a pinned, hash-verified Ollama binary into the app's data directory — no Homebrew required. Individual prompts can override the global provider, so you can mix (e.g. local for most prompts, Claude for one specific summary).
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

## Your first session

### Setup Wizard

On first launch the app opens an in-app Setup Wizard. The five steps:

1. **Welcome.** A short overview, no input.
2. **Obsidian (optional).** Toggle whether you use Obsidian, and pick the vault if so. Existing vaults on your machine are auto-detected. Skip the toggle and Gistlist works fine on its own.
3. **Where to store meetings.** Pick a folder on disk (default `~/Documents/Gistlist`) and choose **Delete audio after**: Never (default), 7 days, 30 days, or a custom number of days.
4. **Providers and keys.** Pick an LLM provider (Claude / OpenAI / Ollama) and an ASR provider (`parakeet-mlx` / `openai` / `whisper-local`), then enter any required API keys. Keys go into the macOS Keychain under the service name `gistlist`.
5. **Dependencies.** The wizard guides you through installing whatever your choices require: the Parakeet Python environment, Ollama and the `nomic-embed-text` embedding model (used for semantic search via Claude Desktop), and macOS microphone + system-audio permissions. Conditional — only the bits you opted into get installed.

Config is written to `~/.gistlist/config.yaml`. If you chose Obsidian, the wizard bootstraps `Meetings/Runs/`, `Meetings/Config/`, `Meetings/Templates/`, a `Dashboard.md`, a notes template, and `Config/pipeline.json` inside the vault. Re-open Settings at any time to switch providers, rotate keys, or change the ASR engine.

### Pages you'll use

The app has a small navigation. Most of your time is on the **Meetings list** and a **Meeting Details** page.

| Page | What it's for |
| --- | --- |
| Record | Start, stop, pause, resume; live mic + system meters. |
| Meetings | Your library. Drop an audio/video file here to import an existing recording. Search, bulk reprocess. |
| Workspace | Pre-meeting prep notes for a staged or scheduled meeting (saved as `prep.md`). |
| Details | Tabs for a finished meeting: Metadata, Summary, Analysis, Transcript, Recording, Files. |
| Prompts | In-app editor for the prompts that turn transcripts into outputs. |
| Settings | Providers, keys, audio, storage, integrations, updates. |
| Activity | Background job log. |

### Record or import

- **Record.** Hit Record (or use the global shortcut from Settings → Other → Keyboard Shortcuts). Live meters show that mic + system audio are coming in. Stop when you're done; processing kicks off automatically.
- **Import.** Drag an audio or video file onto the Meetings page, or use the file-picker on the same page. Gistlist creates a meeting from it and runs the same transcription + prompt pipeline.

### Review the output

After processing, the meeting opens on Details → Summary. From there:

- **Analysis** tab — runs any of the shipped prompts on demand, plus your own.
- **Transcript** tab — full speaker-attributed transcript with click-to-seek audio playback.
- **Recording** tab — the audio file directly.
- **Files** tab — anything you attached during prep.

The notes are plain markdown on disk — see the next section for the layout.

---

## Where your meetings live on disk

Gistlist stores everything under the **data directory** you picked in the Setup Wizard (default `~/Documents/Gistlist`; canonical config key is `data_path`). Obsidian users see the same layout under their vault's chosen subfolder. App state — config, logs, the meeting-index database — lives in `~/.gistlist`.

| What | Where |
| --- | --- |
| Meetings | `<data_path>/Runs/YYYY/MM/DD/<meeting>/` |
| Pipeline config | `<data_path>/Config/pipeline.json` |
| Prompt templates | `<data_path>/Templates/` (or `<data_path>/Config/prompts/` depending on layout) |
| Dashboard (Obsidian) | `<vault_path>/<base_folder>/Dashboard.md` |
| App config | `~/.gistlist/config.yaml` |
| App log | `~/.gistlist/app.log` |
| Parakeet venv | `~/.gistlist/parakeet-venv/` |
| API keys | macOS Keychain, service `gistlist` |
| Meeting index (FTS + vectors) | `~/.gistlist/meetings.db` (`chat_chunks`, `chat_chunks_fts`, `chat_chunks_vec`) |

### A typical completed meeting folder

```
<data_path>/Runs/2026/04/25/<meeting-slug>/
├── notes.md          # main editable note (consolidated output)
├── prep.md           # pre-meeting prep notes (only present if you used Workspace)
├── transcript.md     # full speaker-attributed transcript
├── audio/
│   ├── mic.{wav,ogg,flac}      # source channels; format follows the storage mode
│   ├── system.{wav,ogg,flac}   # absent for mic-only recordings
│   └── combined.{wav,ogg}      # playback file used for click-to-seek
└── attachments/      # files attached during prep or notes (only when present)
```

After audio retention deletes, the `audio/` directory is gone but `notes.md`, `prep.md`, and `transcript.md` stay.

### Audio storage modes

Gistlist records and processes meetings as WAV first so capture, drift correction, acoustic echo cleanup, transcription, and click-to-seek alignment all work from stable local files. After a meeting has processed successfully, the app compacts the stored audio according to **Settings → Storage → Audio Storage**:

| Mode | Stored source channels | Stored playback | Best for |
| --- | --- | --- | --- |
| Compact | `mic.ogg` + `system.ogg` (Opus, 48 kbps mono) | `combined.ogg` (Opus, 32 kbps mono) | Normal voice meetings, replay, and future transcript reruns with much smaller files |
| Lossless archive | `mic.flac` + `system.flac` | `combined.ogg` | Bit-exact source preservation with smaller playback |
| Full fidelity | `mic.wav` + `system.wav` | `combined.wav` | Maximum preservation, largest storage use |

Compact is the default. It keeps separate source channels plus a combined playback file, usually around **60-70 MB per hour** for a two-channel voice meeting. Transcript reprocessing from Compact audio uses the compressed source channels, so results can differ slightly from the original WAV-based run; prompt-only reprocessing uses the existing transcript and is unaffected.

### Audio retention

**Settings → Storage → Audio File Retention** controls how long audio files are kept. Pick **Delete audio after**: Never (default), 7 days, 30 days, or a custom number of days. Retention deletes the whole `audio/` directory while preserving notes, transcripts, and prompt outputs.

### Compact existing meetings

For existing WAV-heavy libraries, use the developer migration script. It is dry-run by default:

```bash
npm run compact:audio --workspace @gistlist/app
```

Apply compaction after reviewing the estimate:

```bash
npm run compact:audio --workspace @gistlist/app -- --apply --mode compact
```

Target one meeting folder:

```bash
npm run compact:audio --workspace @gistlist/app -- --run-folder "/path/to/Runs/2026/04/25/meeting" --apply
```

### Duplicate speaker regression

If a transcript shows the same remote-speaker text under both `Me` and `Others`, run the real-pipeline regression against a private meeting that reproduces it:

```bash
npm run test:duplicate-speakers --workspace @gistlist/app -- --run-folder "/path/to/Runs/2026/04/25/meeting"
```

The script copies the meeting to a temp directory, reprocesses the transcript there, and fails if long near-duplicate `Me`/`Others` segments remain. It never mutates the original meeting.

---

## LLM provider: cloud or local

Gistlist can summarize meetings with **Anthropic Claude** (cloud, fastest, costs API credits), **OpenAI** (cloud, costs API credits), or a **local LLM via Ollama** (free, fully offline, slower per section). You can switch providers in **Settings → LLM** at any time, and individual prompts can override the default — useful if you want most outputs local but one specific prompt to hit Claude or OpenAI.

### Local mode (Ollama)

If you pick local mode and don't already have Ollama installed, the Setup Wizard downloads a pinned, hash-verified Ollama binary into the app's data directory (`<userData>/bin/ollama`) — no Homebrew or separate install needed. If you already have Ollama on `PATH`, Gistlist uses that instead and never duplicates the binary. On startup, Gistlist will:

1. **Reuse a system Ollama daemon** if one is already running on `localhost:11434`. We just talk to it — no second daemon, no duplicate models.
2. Otherwise, **spawn a daemon ourselves** — preferring a system `ollama` on `PATH`, falling back to the bundled-by-the-wizard binary — and stop it cleanly when you quit.

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

## Customizing prompts

Six prompt templates ship with Gistlist:

- `summary` — runs automatically on every meeting.
- `coaching`, `customer-call-recap`, `decision-log`, `next-steps-email`, `one-on-one-follow-up` — visible on each meeting's Analysis tab; run on demand when you click them.

You can edit any of them in-app on the **Prompts** page, or directly in the prompt files on disk (`<data_path>/Templates/` for the desktop app; the CLI stores them in the same folder). Prompts are markdown files with YAML frontmatter:

```markdown
---
id: next-steps-email
label: Next-Steps Email
description: Draft a follow-up email summarizing decisions and action items.
sort_order: 40
enabled: true
auto: false
---

You are drafting a follow-up email after the meeting whose transcript follows.
Cover decisions, owners, and dates. Keep it under 200 words.
```

Per-prompt overrides let you mix providers — set `provider: claude` or `model: gpt-4o` in the frontmatter and that one prompt will use the override even if your global LLM is Ollama. Useful when a single prompt benefits from a stronger model. Reset a built-in to its shipped default at any time from the Prompts page (or `gistlist prompts reset <id>`).

---

## Asking questions across your meetings (Claude Desktop + MCP)

Gistlist ships an MCP server — a small stdio subprocess that Claude Desktop spawns locally. Once installed, you can ask Claude anything about your library ("what did Lauren say about pricing last month?", "summarize my 1:1s with Alex this quarter") and it returns retrieval-grounded answers with clickable audio citations.

What Claude can do once the extension is installed:

- **List recent meetings** — filter by participant, date range, or status.
- **Search meetings** — hybrid keyword + semantic search; returns snippets with clickable timestamps.
- **Get meeting** — pull the full markdown for one meeting (notes + transcript + prep + summary) so Claude reasons from the source, not the snippet.

Setup details:

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

## Settings — current tabs

A quick reference for what's where. Settings opens from the sidebar.

| Tab | What you do here |
| --- | --- |
| Models | Change the LLM and ASR providers, enter API keys, pick local Ollama models, edit the Chat Launcher prompt templates. |
| Audio | Pick the microphone input device. Toggle Apple voice processing — Apple's built-in echo cancellation + noise suppression on the mic, on by default. Recommended when recording with built-in speakers (which otherwise bleed into the mic and cause echoey playback); turn off if voices sound clipped or processed. |
| Meeting index | Install the embedding model (`nomic-embed-text`) and rebuild the local search index used by Claude Desktop MCP. |
| Integrations | Install or remove the Gistlist extension for Claude Desktop; live status for the extension, Ollama, and the meeting index. |
| Storage | Change the data folder, toggle Obsidian and pick a vault, choose audio storage mode and audio retention. |
| Other | Recording shortcut, system health checks, auto-update preferences, support links and logs. |

---

## CLI (advanced / secondary)

> The CLI lags behind the desktop app and doesn't support meeting prep, live prompt streaming, or the Claude Desktop MCP integration. New users should use the desktop app. The CLI is here for scripting, headless environments, and a few maintenance commands that aren't surfaced in the UI yet.

To use it, build and symlink from the repo root:

```bash
npm run build
npm link
gistlist --help
```

After `npm link`, the `gistlist` command is on your `PATH`. If `gistlist` doesn't show up after `npm link` from the repo root (some npm versions don't propagate workspace `bin` entries), run `npm link --workspace @gistlist/cli` instead. You only need to re-run `npm link` if you delete `dist/`/`node_modules`, change the `bin` entry in `packages/cli/package.json`, or move the project directory.

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

## Repo / packages

This is a contributor footnote. The repo is an npm workspace with four packages:

| Package | Purpose |
| --- | --- |
| `packages/app` | Electron desktop app (main process, preload bridge, renderer, IPC). |
| `packages/engine` | Recording, transcription, prompt loading, run processing, on-disk layout. Shared by app, cli, and mcp-server. |
| `packages/cli` | The `gistlist` Node CLI. |
| `packages/mcp-server` | Stdio MCP server spawned by Claude Desktop; read-only over `meetings.db`. |

---

## Testing

For the full list of test commands and when to use each, see the **Testing** section in [AGENTS.md](./AGENTS.md). That's the source of truth — the table covers `npm test`, the Playwright suites (full, fast, focused, live-Electron), and the native-module rebuild dance required when switching between the Node test runtime and the Electron runtime.

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
