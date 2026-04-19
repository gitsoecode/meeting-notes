# Meeting Notes

A local-first desktop meeting workspace with editable markdown, local control, and customizable prompt-driven outputs. The Electron app is the primary product, with Obsidian as an optional integration layer. Meeting Notes records mic + system audio, transcribes locally (or via OpenAI), runs prompts over the transcript to produce structured notes, and keeps the resulting files on disk.

---

## Prerequisites

Install these before running anything:

- **Node ≥ 20**
- **Obsidian** with the **Dataview** plugin enabled (the dashboard depends on it)
- An **Anthropic API key** (Claude is the LLM provider)
- For the default `parakeet-mlx` ASR provider:
  - **Python 3.12** (or 3.11)
  - **ffmpeg** (`brew install ffmpeg`)
  - **macOS 14.2+** for automatic system audio capture (older macOS records mic-only)

If you pick the `openai` ASR provider instead, you'll also need an OpenAI API key and you can skip the Python/Parakeet steps.

---

## Install

```bash
git clone <repo-url> ~/Projects/Meeting-notes
cd ~/Projects/Meeting-notes
npm install
npm run build
npm link
```

After `npm link`, the `meeting-notes` command is on your `PATH`. Verify with:

```bash
meeting-notes --help
```

## Desktop App Development

### Build the desktop app once

```bash
npm run build --workspace @meeting-notes/app
```

This builds the Electron main process, preload bridge, renderer, and packaged app assets into `packages/app/dist/`.

### Run the desktop app in development

```bash
npm run dev --workspace @meeting-notes/app
```

This starts:

- the TypeScript watcher for the Electron main process
- the TypeScript watcher for the preload bridge
- the Vite dev server for the renderer
- Electron pointed at the local dev build

Leave this running while working on the app. Save-to-rebuild is automatic.

### Start the desktop app without watchers

If you already built the app and just want to launch it:

```bash
npm run start --workspace @meeting-notes/app
```

### Package the macOS app

```bash
npm run package:mac --workspace @meeting-notes/app
```

This runs the app build, checks bundled binaries, and creates a macOS package under `packages/app/release/`.

---

## Configure

### 1. Run the setup wizard

```bash
meeting-notes init
```

This interactively asks for:
- Obsidian vault path (default `~/Obsidian/My-Vault`)
- Base folder inside the vault (default `Meetings`)
- ASR provider (`parakeet-mlx` | `openai` | `whisper-local`)
- Mic device name (default `default`)
- System audio is captured automatically on macOS 14.2+ (no setup needed)
- Your Anthropic API key (and OpenAI key if you chose `openai`)

It then:
- Writes `~/.meeting-notes/config.yaml`
- Stores API keys in the **macOS Keychain** under the service name `meeting-notes`
- Bootstraps your vault: creates `Meetings/Runs/`, `Meetings/Config/`, `Meetings/Templates/`, a `Dashboard.md`, a notes template, and `Config/pipeline.json`

### 2. Install the local ASR engine (only if you picked `parakeet-mlx`)

```bash
meeting-notes setup-asr
```

This creates a Python venv at `~/.meeting-notes/parakeet-venv/`, installs `mlx-audio`, runs a smoke test, and updates your config with the binary path.

### 3. Open Obsidian

Open the vault you configured, enable the **Dataview** plugin, and open `Meetings/Dashboard.md`.

---

## LLM provider: cloud or local

Meeting Notes can summarize meetings either with **Anthropic Claude** (cloud, fastest, costs API credits) or with a **local LLM via Ollama** (free, fully offline, slower per section). You can switch providers in **Settings → LLM** at any time, and individual prompts can override the default — useful if you want most outputs local but one specific prompt to use Claude.

### Local mode (Ollama)

In development, Meeting Notes will prefer a system `ollama` on `PATH` if you already have one installed. For packaged macOS releases, we bundle the Ollama binary into the `.app` so end users don't need to install anything separately. On startup, Meeting Notes will:

1. **Reuse a system Ollama daemon** if one is already running on `localhost:11434`. We just talk to it — no second daemon, no duplicate models.
2. Otherwise, **spawn a daemon ourselves** — preferring a system `ollama` binary on `PATH` if one exists, falling back to the bundled binary in packaged builds — and stop it cleanly when you quit.

Models live in the standard `~/.ollama/models` directory regardless of which daemon ends up serving them. That means any models you've already pulled with Ollama are picked up automatically with **no duplicate downloads**, and anything you pull from inside Meeting Notes is also visible to a system Ollama install if you ever set one up.

**Picking a model.** The Settings → LLM dropdown lists a curated set of models chosen for transcript-style work (action items, structured outputs, agentic prompts). Defaults are filtered by your machine's RAM:

| Model | Size | Min RAM |
| --- | --- | --- |
| Qwen 3.5 9B *(recommended)* | ~5.5 GB | 16 GB |
| Gemma 4 E4B | ~4 GB | 16 GB |
| Qwen 3 8B | ~5 GB | 16 GB |
| Gemma 3 12B | ~7.5 GB | 24 GB |

The **Custom…** option lets you type any tag from [ollama.com/library](https://ollama.com/library), so you're not locked into the curated list — useful when a new model drops between releases.

**Speed expectations.** On a 16 GB Apple Silicon machine, a typical 30-minute meeting summary takes 30 s – 2 min per prompt with a 7B–9B model. The Meeting Detail page shows a live spinner and elapsed-seconds counter for each running section, plus a "Running locally" hint after 20 s, so you can see something is happening even on long sections.

**Anthropic API key.** When you run in local-only mode you don't need a Claude API key at all — leave the Anthropic field blank in the wizard and in Settings. You can add a key later if you want a specific prompt to use Claude.

### Local mode (Parakeet, transcription)

Transcription is a separate path. Meeting Notes uses **Parakeet** (Apple Silicon MLX) for fully local transcription. Parakeet is installed during the Setup Wizard's dependencies step into a Python venv at `~/.meeting-notes/parakeet-venv` — the wizard handles this end-to-end, no Homebrew needed. If you'd rather use OpenAI's cloud transcription instead, switch the provider in **Settings → Transcription**.

---

## Chat

The **Chat** tab lets you ask questions across every meeting in your library. It does retrieval-grounded search over your transcripts, summaries, and prep notes, and surfaces answers with clickable citations — each citation jumps to the exact moment in the meeting and plays the audio from there.

The assistant is **read-only**: it can't edit, delete, or rename anything. Each thread is isolated (no cross-thread memory).

### What it needs

- The same Ollama daemon Meeting Notes already uses for local LLMs.
- A chat model (defaults to whatever you picked in Setup — e.g. `qwen3.5:9b`). You can switch per thread.
- The **`nomic-embed-text`** embedding model (~274 MB). Pulled automatically on first launch and also surfaced in **Settings → Chat → Chat embedding model**.

If `sqlite-vec` (the native extension that powers vector search) fails to load — or if the embedding model isn't installed — Chat degrades to keyword search only. It doesn't crash. You'll lose paraphrase recall (asking about "rates" won't hit a transcript that said "pricing") but literal matches still work.

### How indexing works

- Every completed or reprocessed meeting is indexed immediately into an FTS5 + vector index inside `~/.meeting-notes/meetings.db`.
- Pre-existing meetings are indexed in the background the first time you open Chat (or from **Settings → Chat → Re-run indexing**). Under 5 meetings indexes silently; up to 50 shows an unobtrusive progress strip; 50+ shows an explicit Start/Later card.

### Settings → Chat

- **Chat embedding model** — status + Install button
- **System prompt** — full editor with Save / Reset to default. Controls how the assistant behaves; the default is tuned to cite sparingly, prefer transcript citations over summary/prep/notes, and refuse to fabricate.
- **Re-run indexing** — rebuilds the chat index over every meeting.

### Switching models

Pick a per-thread model from the composer's model label or from the thread's kebab menu. Installed Ollama tags, Anthropic, and OpenAI models appear in grouped sections (cloud models only if the matching API key is set in Keychain).

### Filter by participant

The composer has a small `Filter` button that takes a participant name. Known participants are suggested from the `run_participants` table when populated; otherwise it falls back to matching the name against meeting titles (so "Lauren" finds the "Lauren Dai catchup" run even if no participants were auto-extracted).

---

## Updating after code changes

`npm link` is just a symlink to `dist/cli/index.js`, so you only need to rebuild — not relink.

**One-off rebuild:**
```bash
npm run build
```

**While actively developing**, leave this running in a terminal tab:
```bash
npm run dev
```
That's `tsc --watch` — it recompiles automatically on save, and `meeting-notes` picks up the new build on the next invocation. Nothing else is required (it's not a server).

You only need to re-run `npm link` if you delete `dist/`/`node_modules`, change the `bin` entry in `package.json`, or move the project directory. Re-run `npm install` only when `package.json` dependencies change.

---

## Useful commands

| Command | What it does |
| --- | --- |
| `meeting-notes init` | First-time setup wizard |
| `meeting-notes set-key <claude\|openai>` | Add or rotate an API key in the Keychain |
| `meeting-notes setup-asr` | Install the local Parakeet ASR engine |
| `meeting-notes start [-t "Title"]` | Start a recording (title defaults to "Untitled Meeting") |
| `meeting-notes stop` | Stop the active recording and process it |
| `meeting-notes status` | Show recording status |
| `meeting-notes process <audio-file>` | Process an existing audio file |
| `meeting-notes reprocess <run-path>` | Re-run processing on an existing run |
| `meeting-notes logs [run-path]` | Show app or run logs |
| `meeting-notes prompts list` | List configured pipeline prompts |
| `meeting-notes test-audio` | Test audio capture from configured devices |

Run `meeting-notes --help` or `meeting-notes <command> --help` for the full list and options.

---

## Audio Testing

Verify audio capture is working:

```bash
meeting-notes test-audio
meeting-notes test-audio --duration 6000   # 6-second test (default 4s)
```

This records a short clip from each configured device, analyzes volume levels, and reports whether each device is found, capturing audio, and not silent.

---

## Where things live

| What | Where |
| --- | --- |
| Config | `~/.meeting-notes/config.yaml` |
| App log | `~/.meeting-notes/app.log` |
| Parakeet venv | `~/.meeting-notes/parakeet-venv/` |
| API keys | macOS Keychain, service `meeting-notes` |
| Recordings & notes | `{vault_path}/{base_folder}/Runs/` |
| Pipeline config | `{vault_path}/{base_folder}/Config/pipeline.json` |
| Templates | `{vault_path}/{base_folder}/Templates/` |
| Dashboard | `{vault_path}/{base_folder}/Dashboard.md` |
| Chat index (FTS + vectors) | `~/.meeting-notes/meetings.db` (`chat_chunks`, `chat_chunks_fts`, `chat_chunks_vec`) |
| Chat threads + messages | Same `meetings.db` (`chat_threads`, `chat_messages`) |
| Chat system prompt override | `~/.meeting-notes/chat-system-prompt.md` (created only after an edit in Settings) |

---

## Troubleshooting

**`meeting-notes: command not found`**
The global symlink isn't in place. From the project directory: `npm run build && npm link`.

**`Config not found at ~/.meeting-notes/config.yaml`**
You haven't run setup yet. Run `meeting-notes init`.

**`No Anthropic API key found in macOS Keychain`**
Run `meeting-notes set-key claude`.

**Dashboard is empty in Obsidian**
Make sure the Dataview plugin is installed and enabled in Obsidian's community plugins.

**Stale behavior after editing code**
You forgot to rebuild. Run `npm run build`, or leave `npm run dev` running in a terminal.

**`better-sqlite3` / `NODE_MODULE_VERSION` mismatch when starting or recording in the desktop app**
The native SQLite module was built for plain Node instead of Electron. Rebuild it for the app runtime:

```bash
PYTHON=/usr/bin/python3 npm_config_build_from_source=true npm_config_runtime=electron npm_config_target=41.2.0 npm_config_disturl=https://electronjs.org/headers npm rebuild better-sqlite3 --workspace @meeting-notes/app
```

Notes:

- `npm test` and `npm run test --workspace @meeting-notes/app` may rebuild `better-sqlite3` for the current plain Node runtime first. That is expected for tests.
- The Electron app needs the Electron-targeted rebuild above if you see `ERR_DLOPEN_FAILED` or a `NODE_MODULE_VERSION` mismatch while launching, opening, or starting a meeting.
- On this repo, `/usr/bin/python3` is the safest Python for native rebuilds because older `node-gyp` versions may fail with newer Python releases.

---

## License

Meeting Notes is licensed under the [Functional Source License, Version 1.1, ALv2 Future License (FSL-1.1-ALv2)](./LICENSE). Copyright © 2026 Gistlist, LLC.

In short: you can read, use, modify, and redistribute this code for any purpose — **except** building a commercial product or service that competes with Meeting Notes. Internal use, non-commercial research, and education are explicitly allowed. Two years after each release, that code automatically converts to Apache 2.0.

This is **source-available** (sometimes called "fair source"), not OSI-approved open source.
