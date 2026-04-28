# Gistlist

> **Your meetings stay on your machine.**

Local-first desktop meeting workspace for macOS. Records mic and system audio, transcribes on-device or via OpenAI, runs prompts over the transcript on Claude / OpenAI / local Ollama, and writes plain markdown to disk.

> **End-user docs live at [gistlist.app/docs](https://gistlist.app/docs).** The rest of this file is for contributors building from source.

---

## Prerequisites (contributor)

- **Node ≥ 20**
- **macOS 14.2+** for system-audio capture testing (older macOS records mic-only)

End-users do not need to install ffmpeg or Python by hand: the in-app
Setup Wizard installs both into `<userData>/bin/` (ffmpeg/ffprobe from
evermeet.cx, Python from python-build-standalone). For contributor work
where you want to run the engine outside the wizard (CLI, headless
tests), system-PATH `ffmpeg` / `python3.12` still work as a fallback —
they're not required to develop the app itself.

The Parakeet ASR path is **Apple Silicon only** (it depends on MLX). On
Intel Macs the wizard hides the Parakeet option and steers users to
OpenAI cloud transcription.

---

## Run from source

There is no signed `.dmg` release yet — you build locally and launch from the repo.

```bash
git clone <repo-url> ~/Projects/Meeting-notes
cd ~/Projects/Meeting-notes
npm install
npm run build
```

`npm run build` is required on a fresh checkout — `@gistlist/engine` exports from `./dist/index.js`, so downstream packages won't resolve until the engine has been built at least once.

### Launch the app

While actively developing, use the dev server:

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

Produces a packaged `.app` under `packages/app/release/`.

---

## Repo / packages

npm workspace with four packages:

| Package | Purpose |
| --- | --- |
| `packages/app` | Electron desktop app (main process, preload bridge, renderer, IPC). |
| `packages/engine` | Recording, transcription, prompt loading, run processing, on-disk layout. Shared by app, cli, and mcp-server. |
| `packages/cli` | The `gistlist` Node CLI (lags behind the desktop app — primarily for scripting and headless environments). |
| `packages/mcp-server` | Stdio MCP server spawned by Claude Desktop; read-only over `meetings.db`. |

---

## Testing

For the full list of test commands and when to use each, see the **Testing** section in [AGENTS.md](./AGENTS.md). That's the source of truth — it covers `npm test`, the Playwright suites (full, fast, focused, live-Electron), and the native-module rebuild dance required when switching between the Node test runtime and the Electron runtime.

---

## Screenshot capture

Marketing-page assets in `gistlist/web/public/assets/`:

```bash
npm run capture:marketing --workspace @gistlist/app
```

Docs-site assets in `gistlist/web/public/docs/screenshots/`:

```bash
npm run capture:docs --workspace @gistlist/app
```

Both use deterministic mock-API state with anonymized synthetic content ("Acme onboarding retro"). Re-run after any change that affects a documented screenshot — see the [Cross-Repo Docs Sync](./AGENTS.md#cross-repo-docs-sync) table in `AGENTS.md`.

---

## Contributor troubleshooting

**`better-sqlite3` / `NODE_MODULE_VERSION` mismatch when starting the desktop app**

The native SQLite module was compiled for plain Node (likely by the test runner) instead of Electron. Rebuild it for the app runtime:

```bash
npm run rebuild:native --workspace @gistlist/app
```

Notes:

- `npm test` automatically rebuilds `better-sqlite3` for the current plain Node runtime first. That's expected for tests.
- The Electron app needs the Electron-targeted rebuild above if you see `ERR_DLOPEN_FAILED` or a `NODE_MODULE_VERSION` mismatch while launching, opening, or starting a meeting.
- You'll flip back and forth between these two builds as you move between test runs and app runs. That's expected — don't spend time debugging it, just run the appropriate rebuild for whichever runtime you need next.

**Stale behavior after editing code**

You forgot to rebuild. Run `npm run build`, or leave `npm run dev --workspace @gistlist/app` running in a terminal.

---

## License

Gistlist is licensed under the [Functional Source License, Version 1.1, ALv2 Future License (FSL-1.1-ALv2)](./LICENSE). Copyright © 2026 Gistlist, LLC.

In short: you can read, use, modify, and redistribute this code for any purpose — **except** building a commercial product or service that competes with Gistlist. Internal use, non-commercial research, and education are explicitly allowed. Two years after each release, that code automatically converts to Apache 2.0.

This is **source-available** (sometimes called "fair source"), not OSI-approved open source.
