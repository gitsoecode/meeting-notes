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
  - **BlackHole 2ch** virtual audio device, for capturing system audio (`brew install blackhole-2ch`)

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
- System audio device (default `BlackHole 2ch`)
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

Run `meeting-notes --help` or `meeting-notes <command> --help` for the full list and options.

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
