# Third-Party Notices for Gistlist

This document lists the open-source software shipped inside the Gistlist
desktop app (or installed on first launch by the setup wizard) along with
the license under which it's redistributed.

The Gistlist app itself is licensed under the **Functional Source License,
Version 1.1, Apache 2.0 Future License (FSL-1.1-ALv2)** — see the root
`LICENSE` file. Gistlist is a product of Gistlist, LLC.

## 1. First-party

| Component | License | Source |
|---|---|---|
| Gistlist desktop app | FSL-1.1-ALv2 | This repository's `LICENSE` |
| Gistlist engine (`@gistlist/engine`) | FSL-1.1-ALv2 | This repository's `LICENSE` |
| Gistlist MCP server (`@gistlist/mcp-server`) | FSL-1.1-ALv2 | This repository's `LICENSE` |

## 2. Bundled helpers (ship inside the .app)

These are distributed as part of the Gistlist `.dmg`. The wizard does
not download them — they are present from first launch.

| Component | License | Notes |
|---|---|---|
| Electron | MIT | Runtime — https://github.com/electron/electron/blob/main/LICENSE |
| AudioTee | MIT | macOS CoreAudio tap helper — https://github.com/withfig/autocomplete-tools (sibling repos under withfig); see `node_modules/audiotee/LICENSE` |
| `mic-capture` (own native helper) | FSL-1.1-ALv2 | Built from `packages/app/native/mic-capture.swift` |
| `better-sqlite3` | MIT | https://github.com/WiseLibs/better-sqlite3/blob/master/LICENSE |
| `sqlite-vec` | Apache-2.0 | https://github.com/asg017/sqlite-vec/blob/main/LICENSE |
| React, Radix UI, Tailwind | MIT / Apache-2.0 | UI libraries — see each package's LICENSE under `node_modules` |
| `electron-updater` | MIT | https://github.com/electron-userland/electron-builder/blob/master/LICENSE |
| `markdown-it`, `dompurify`, `lucide-react`, `date-fns`, etc. | MIT | UI / parsing libraries — see each package's LICENSE under `node_modules` |
| Milkdown / Crepe (`@milkdown/crepe`) | MIT | Markdown editor surface |
| CodeMirror (`@codemirror/*`, `@uiw/react-codemirror`) | MIT | Code editor surface |
| Plyr | MIT | Media player |

## 3. Runtime-installed tools (downloaded by the setup wizard)

These are NOT distributed inside the Gistlist `.dmg`. The user explicitly
opts in during onboarding; the wizard fetches them over HTTPS, verifies a
SHA-256 manifest pin, and installs into `<userData>/bin/`. The user can
remove them by deleting that directory.

| Tool | Version | License | Build variant | Source URL |
|---|---|---|---|---|
| ffmpeg | 7.1.1 | LGPL-2.1-or-later | evermeet.cx LGPL static (no GPL components) | https://evermeet.cx/ffmpeg/ffmpeg-7.1.1.zip |
| Ollama (CLI) | 0.21.2 | MIT | Universal `ollama-darwin.tgz` from upstream Releases | https://github.com/ollama/ollama/releases/download/v0.21.2/ollama-darwin.tgz |

`whisper-cli` (whisper.cpp) is intentionally not offered for first beta —
upstream does not currently ship a signed macOS binary in Releases. When
that changes, an entry will be added here.

## 4. Models pulled by Ollama on demand

When the user picks the "Local (Ollama)" LLM provider, Ollama itself is
responsible for downloading model weights from registry.ollama.ai into
`~/.ollama/models/`. Each model is released under its own license — see
the model card on https://ollama.com for terms specific to that model.

Common defaults Gistlist suggests in the wizard:

- `qwen3.5:9b`, `qwen2.5:14b` — Tongyi Qianwen LICENSE AGREEMENT
- `llama3.1:8b` — Meta Llama 3 Community License
- `nomic-embed-text` — Apache-2.0 (used by the meeting-index embedding)

Gistlist does not redistribute these weights; the user pulls them
through Ollama as a separate, opt-in step.

## 5. ffmpeg / LGPL note

The ffmpeg build downloaded by the wizard is the LGPL-licensed variant
from evermeet.cx (no GPL components, no x264/x265 etc.). Source code for
this exact build is available from evermeet.cx alongside the binary, in
keeping with the LGPL's source-availability requirement. If you redistribute
the Gistlist binary plus this ffmpeg copy (uncommon, but possible if you
package Gistlist into a derivative work), you must comply with LGPL-2.1-
or-later for the ffmpeg portion specifically — see the FFmpeg legal page:
https://www.ffmpeg.org/legal.html.

## Updates to this notice

This file is reviewed each release. The pinned versions in §3 are the
single source of truth: bumping a tool means updating both the manifest
in `packages/app/main/installers/manifest.ts` AND this notice.
