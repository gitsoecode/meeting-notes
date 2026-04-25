# Data Directory Contract

This document is the single source of truth for **where Gistlist stores
each kind of data on disk**, who owns each location, and how that
ownership is allowed to evolve.

It exists because the app and the engine share a filesystem layout, and
the wizard-installed binaries (Phase 2 of the pre-beta plan) introduce
a new Electron-managed root that has to coexist cleanly with the
existing engine paths. Future migrations should treat this doc as the
contract they're permitted to break — not the code, the doc.

## Three roots

Gistlist data lives under three filesystem roots, each owned by a
different layer:

| Root | Owner | What lives here | Override |
|---|---|---|---|
| `~/.gistlist/` | `@gistlist/engine` | App config, prompts, ASR weights, engine logs, SQLite DB, MCP server cache | `GISTLIST_CONFIG_DIR` |
| `<app userData>/` | Electron app | Wizard-installed binaries, in-flight downloads, electron-updater state | `GISTLIST_USER_DATA_DIR` |
| User-chosen `data_path` | User | Per-meeting folders with audio, transcript, summary, prompt outputs | Set in wizard / Settings |

`<app userData>` resolves through Electron's `app.getPath("userData")`,
which on macOS is typically
`~/Library/Application Support/Gistlist/` for production builds and
`~/Library/Application Support/Electron/` in dev. The path includes
the appId, so renaming the app rebases everything below — that's why
this layer doesn't touch user content.

## What lives where (today)

### `~/.gistlist/` (engine-owned)

| Path | Producer | Purpose |
|---|---|---|
| `~/.gistlist/config.yaml` | engine | App config — `data_path`, providers, secrets refs, retention policy |
| `~/.gistlist/meetings.db` | app (`packages/app/main/db/connection.ts`) | SQLite + FTS + sqlite-vec corpus the MCP server reads |
| `~/.gistlist/prompts/` | engine (`migrate-prompts.ts`) | User-editable prompt library (one .md file per prompt) |
| `~/.gistlist/parakeet-venv/` | engine (`setupAsr`) | Python venv for Parakeet ASR — about 600 MB of model weights |
| `~/.gistlist/app.log` | engine logger | App startup / lifecycle log — surfaced by the "Reveal logs in Finder" button |
| `~/.gistlist/ollama.log` | `main/ollama-daemon.ts` | Ollama daemon's stdout/stderr when we spawn it |

`GISTLIST_CONFIG_DIR` redirects this entire tree. The engine's
`getConfigDir()` is the only API that reads the env var; everything
else flows through `path.join(getConfigDir(), …)`. Used by the MCP
server (which runs out-of-process) and by tests that want isolated
state.

### `<app userData>/` (Electron-owned, **NEW** in Phase 2)

| Path | Producer | Purpose |
|---|---|---|
| `<userData>/bin/` | `main/installers/*` | Wizard-installed binaries: ffmpeg, ollama (CLI), whisper-cli |
| `<userData>/downloads/` | `main/installers/download.ts` | Staging dir for in-flight downloads. Atomically renamed into `bin/` after SHA-256 + signature + verifyExec all pass. Anything in `bin/` is by construction a verified executable. |
| `<userData>/updater/` | electron-updater | Downloaded update artifacts. `autoInstallOnAppQuit: false` keeps these around until the user explicitly clicks Install. |

`GISTLIST_USER_DATA_DIR` redirects this entire tree. Used by
`specs/smoke-built-app.spec.ts` so tests never touch real userData.

`bin/` and `downloads/` deliberately share a parent — `fs.renameSync`
is only POSIX-atomic when source and destination are on the same
volume. Co-locating them under `<userData>` guarantees the volume
match and lets the installer use a stage-then-atomic-move pattern.

### User-chosen `data_path` (user-owned)

Default: `~/Documents/Gistlist/` (or `<vault>/Meeting-notes/` when
Obsidian integration is enabled). Configurable in the setup wizard's
"Where should meetings be stored?" step and in Settings.

Layout:

```
<data_path>/
├── 2026-04-15-team-standup-a1b2c3/
│   ├── audio.flac
│   ├── transcript.md
│   ├── summary.md
│   ├── prep.md            (when present)
│   ├── notes.md           (user-editable)
│   ├── manifest.yaml
│   └── …prompt outputs…
└── …
```

Per-meeting folders are named `YYYY-MM-DD-<slug>-<short-id>` and own
all artifacts for that meeting. Deletion of a folder is the
authoritative delete — `seedDbFromFilesystem` heals the database from
the filesystem on every startup.

## What lives outside Gistlist's control

| Path | Owner | Notes |
|---|---|---|
| `~/.ollama/models/` | Ollama itself | Model weight cache. Shared with any system Ollama install — we don't pull duplicates if Homebrew or `~/Applications/Ollama.app` already populated it. |
| `~/Library/Logs/Gistlist/` | Chromium | Renderer / GPU process internals. Not user-meaningful for support email triage. The "Reveal logs in Finder" button intentionally points at `~/.gistlist/` instead. |

## Migration story

No migrations are executed by this doc — it is a contract, not a
runner. The pattern future migrations should follow:

1. **Decide before moving.** Adding a new path is cheap; moving an
   existing one breaks every user with state on disk. Bias toward
   adding new locations rather than relocating existing ones.
2. **Detect old → new on startup.** A new helper in `main/migrations/`
   reads the current state, decides whether a move is needed, and
   performs it inside a single transaction (or under a lock). Failure
   leaves the old path intact.
3. **Log the decision.** Migrations write to `~/.gistlist/app.log`
   so the user can see what moved and when. The "Reveal logs"
   button surfaces this.
4. **One-way doors get version-stamped.** If a migration cannot be
   reversed (e.g., DB schema change), bump the schema version field
   so older app builds refuse to open the new file rather than
   corrupting it.

The first real migration we'll need is for `~/.gistlist/parakeet-venv/`
when we eventually move to a bundled Parakeet binary — out of scope
for the pre-beta plan, but flagged here so it doesn't surprise us.

## Summary table for support triage

When a tester says "something is wrong," the relevant paths are:

| Symptom | Look at |
|---|---|
| Won't launch / config issue | `~/.gistlist/config.yaml` and `~/.gistlist/app.log` |
| Recording produced silence | `~/.gistlist/app.log` (mic + AudioTee permission events) |
| Transcript missing or corrupt | `<data_path>/<meeting>/audio.flac` and the meeting's `manifest.yaml` |
| LLM call failed | `~/.gistlist/app.log` + provider response in the meeting folder |
| Update wouldn't install | `<userData>/updater/` (and electron-builder's `latest-mac.yml`) |
| Wizard install of ffmpeg/ollama failed | `<userData>/downloads/` (partial files) — should be empty unless an install is in flight |
