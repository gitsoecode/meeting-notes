# Meeting Notes

A local-first meeting recording and processing tool with an Obsidian workspace. Records mic + system audio, transcribes locally (or via OpenAI), runs Claude over the transcript to produce structured notes, and writes everything into your Obsidian vault. Today it ships as a Node CLI; an Electron app will follow.

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
