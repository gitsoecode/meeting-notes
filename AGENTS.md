# AGENTS.md

## Project Identity

Gistlist is a local-first desktop meeting workspace for solo power users. The product is a desktop app first. Obsidian is an optional integration layer, not a required mode. The core value is editable markdown, local control, and customizable prompt-driven outputs.

## Repo Map

- `packages/app`
  Electron desktop app, preload bridge, IPC layer, renderer flows, and app-specific tests.
- `packages/app/main/chat-index/`
  Writer side of the meeting-index corpus read by the MCP server: post-process chunking hooks, Ollama embeddings, FTS+sqlite-vec schema owner, backfill state machine. (No retrieval loop lives here anymore — the in-app Chat surface was deprecated in favor of Claude Desktop + MCP in 2026-04.)
- `packages/app/main/meeting-index/`
  IPC surface (`meeting-index:*`) that exposes backfill and embed-model controls to the renderer's Settings and SetupWizard.
- `packages/mcp-server/`
  Stdio MCP server spawned by Claude Desktop. Read-only over `meetings.db`; bypasses app/main and imports the retrieval primitives directly from `@gistlist/engine`. This is the chat surface now.
- `packages/engine`
  Shared core for config, recording, transcription, prompt loading, run processing, and filesystem layout.
- `packages/engine/src/core/chat-index/`
  Pure (no-DB) meeting-index primitives: speaker-turn chunker, markdown chunker, transcript.md parser, Ollama `/api/embed` client, retrieval (`searchMeetings`, `listMeetings`), shared types. Consumed by both the app-side writer and the MCP server.
- `packages/cli`
  Node CLI wrapper around the engine for setup, recording, and maintenance workflows.
- `docs/`
  Repo-local documentation, including smoke checks and future plan documents.

## Non-Negotiable Guardrails

- Keep Electron `sandbox: true` on by default. Do not disable it unless a task explicitly requires it and the change is justified in code or docs.
- Renderer filesystem access must stay scoped. Do not introduce arbitrary-path read, write, delete, or open APIs back into IPC.
- Validate run paths against the configured runs root before touching files on disk.
- If a recording is interrupted during app quit, preserve the captured files and keep the run recoverable. Do not silently discard interrupted runs.
- Shortcut settings must map to real registration behavior. Do not leave “saved but inactive” shortcut settings in the UI.
- Prompt files remain the source of truth. Do not add a separate prompt registry or database layer unless a task explicitly requires it.
- Builtin prompts are resettable shipped defaults. `auto` controls autorun behavior; do not rely on `builtin` as the execution switch.

## How To Work In This Repo

- **All tests must pass before completing any task.** Do not dismiss failures as "pre-existing" or "unrelated." If tests fail, fix them — whether or not your changes caused the failure.
  - **Iteration loop (fast):** while iterating on a fix, run only the directly-affected specs via `npm run test:e2e:focus --workspace @gistlist/app -- specs/<area>.spec.ts` (8s timeout, 4 workers, desktop-only, line reporter). For a quick "is the whole surface broken?" check, `npm run test:e2e:fast` bails after 5 failures. Do NOT run the full suite during iteration — it wastes time and buries the signal.
  - **Failing tests must fail fast.** A spec sitting in a long retry loop is a locator problem; investigate the selector, don't wait it out. The Playwright config caps per-test time at 10s for this reason.
  - **Manual Smoke vs Full Suite:** Give the user an opportunity to manual smoke test before running the full required suite (`npm test` and `npm run test:e2e --workspace @gistlist/app`), unless they explicitly ask you to run it sooner.
  - **Do not consider an issue resolved until tests are run.**
  - After user confirmation, run `npm test` (unit) and `npm run test:e2e --workspace @gistlist/app` (Playwright — full suite, both projects) and confirm zero failures before finishing.
- Build and regression-check with `npm test`.
- Read `docs/private_plans/testing-playbook.md` before changing app flows, Playwright fixtures, page objects, IPC-backed UI behavior, or run-lifecycle behavior.
- Use `docs/private_plans/smoke-flow.md` for manual QA when changing app flows such as recording, reprocessing, prompts, import, settings, or quit behavior.
- For app changes, prefer this test sequence unless the task clearly calls for something narrower:
  1. `npm run test --workspace @gistlist/app`
  2. targeted Playwright specs for the changed area
  3. `npm run test:e2e --workspace @gistlist/app`
  4. `npm test`
  5. `npm run test:e2e:electron --workspace @gistlist/app` — **only when the change touches meeting-index writes (chunking/embedding), deep-link handling, citation playback, SetupWizard flows, or other Electron-main-process behavior that mocks can't prove.** Boots the real packaged main process, the real `meetings.db`, and talks to the user's live Ollama daemon + local library. Takes several minutes; skips cleanly if Ollama isn't reachable. See `docs/private_plans/testing-playbook.md` for the three-tier stack.
  6. `npm run rebuild:native --workspace @gistlist/app` — **always run this after tests finish** so the Electron app can start. Tests rebuild `better-sqlite3` for Node.js; this restores it for Electron.
- For UI changes, the default testing bar is action completeness, not route render:
  - cover visible buttons, menus, tabs, dropdowns, row actions, bulk actions, and modal confirm/cancel paths on affected pages
  - prefer page-object and semantic assertions over brittle global text checks
  - if a page is stateful or run-scoped, add at least one resilience-path test
- Keep Playwright’s `mock-api.ts`, shared fixtures, and page objects aligned with real app behavior. If a feature changes route behavior, IPC semantics, or meeting-state transitions, update the test harness in the same task.
- Add or update resilience coverage for run-scoped features that can encounter stale, missing, partial, or interrupted state.
- Prefer small shared helpers over growing `packages/app/main/ipc.ts` with more business logic.
- For renderer UI work, prefer `shadcn/ui` primitives and composition patterns as the default approach. Favor extending the shared component layer under `packages/app/renderer/src/components/ui` over introducing new bespoke controls or one-off styling patterns.
- UI layout philosophy: **rely on whitespace and typography, not borders and boxes.** Default to `<section>` + `<h3>` + whitespace (and `<Separator />` from `components/ui/separator.tsx`) for stacking sections inside a page or tab. Reserve `<Card>` for true floating surfaces — popovers, dropzones, pane-separated dashboards, modal-like widgets on the home screen. Never place a `<Card>` inside a container that already defines a boundary (a `<TabsContent>`, a split pane, a dialog). If a section contains a table or dense grid, a minimal `rounded-md border border-[var(--border-subtle)]` wrapper is enough — no shadow, no tinted header.
- When changing user-facing product copy, preserve the current positioning unless the task explicitly changes it:
  `desktop app`, `Obsidian optional`, `local-first`, `editable markdown`, `customizable outputs`, `source-available` (never "open source").
  Primary tagline: **"Your meetings stay on your machine."** See [`docs/private_plans/brand-and-direction.md`](docs/private_plans/brand-and-direction.md) for the full voice rules, banned-word list, and tone examples.
- **Keep [`README.md`](README.md) current with shipped behavior.** The README is our only user-facing guide until the marketing docs site is live. When a change adds, removes, or renames anything user-visible — Settings tabs/sections, Setup Wizard steps, CLI commands, config keys, default prompts, on-disk run-folder layout, bundled binaries, or supported platforms — update [`README.md`](README.md) in the same task. Compact UI references are fine; aim for workflow guidance over exhaustive inventory so the README stays low-drift.

## Testing

Quick reference. See "How To Work In This Repo" above for the policy around when each command is required — this table is a lookup, not a replacement for that guidance.

| Command | When to use |
| --- | --- |
| `npm test` | Unit + integration gate at repo root. Also rebuilds `better-sqlite3` for Node. Required before completing any task. |
| `npm run test --workspace @gistlist/app` | App-level unit tests only. Faster signal during iteration. |
| `npm run test:e2e --workspace @gistlist/app` | Full mock-backed Playwright suite (desktop + narrow viewport projects). Does **not** cover Electron main-process behavior — that lives in `test:e2e:electron`. Required before completing any task. |
| `npm run test:e2e:focus --workspace @gistlist/app -- specs/<area>.spec.ts` | Iteration loop. 8s timeout, 4 workers, desktop-only, line reporter. |
| `npm run test:e2e:fast --workspace @gistlist/app` | "Is the whole surface broken?" — bails after 5 failures. |
| `npm run test:e2e:electron --workspace @gistlist/app` | Live-Electron suite. Only when touching meeting-index writes, deep-link handling, citation playback, SetupWizard flows, or other main-process behavior mocks can't prove. Needs a running Ollama. |
| `npm run rebuild:native --workspace @gistlist/app` | Run **after** `npm test` to restore the Electron-targeted `better-sqlite3` binary. |

## Native Module Rebuild (better-sqlite3)

`better-sqlite3` is a native C++ addon that must be compiled for the correct Node ABI. Node.js and Electron use **different** ABI versions (e.g. Node = 127, Electron = 145), and only one compiled binary exists on disk at a time.

- `npm test` automatically rebuilds for **Node.js** (via `ensure-better-sqlite3.mjs`). After running tests, the Electron app will crash with `ERR_DLOPEN_FAILED` / `NODE_MODULE_VERSION` mismatch.
- To restore the Electron app after running tests: `npm run rebuild:native --workspace @gistlist/app`
- `npm run rebuild:native` rebuilds for **Electron** (via `electron-rebuild`). After this, Node-based tests will fail until the next `npm test` run auto-repairs them.

**This is expected.** Do not spend time debugging the mismatch — just run the appropriate rebuild command for whichever runtime you need next. If the user reports the app can't load meetings or crashes on start after you ran tests, tell them to run `npm run rebuild:native --workspace @gistlist/app`.

## Reference Docs

### Read before changing the relevant area

- [`docs/private_plans/brand-and-direction.md`](docs/private_plans/brand-and-direction.md) — Canonical brand doc: product soul, voice rules, banned-word list, design statement, positioning words. Read before writing any user-facing copy or making a positioning decision.
- [`docs/private_plans/website-brief.md`](docs/private_plans/website-brief.md) — Self-contained spec for the marketing site (separate repo). Read before editing public copy that should stay in sync with the site, or before changing brand-visible defaults (bundle ID, product name, tagline).
- [`docs/private_plans/naming-and-migration.md`](docs/private_plans/naming-and-migration.md) — Record of the 2026-04-19 rename from Meeting Notes to Gistlist, including migration steps for a live install. Read before changing CLI names, config paths, or keychain service strings.
- [`docs/private_plans/testing-playbook.md`](docs/private_plans/testing-playbook.md) — Three-tier testing stack, action-completeness standard, fixture conventions. Read before changing app flows, Playwright fixtures, page objects, IPC-backed UI, or run-lifecycle behavior.
- [`docs/private_plans/smoke-flow.md`](docs/private_plans/smoke-flow.md) — Manual QA checklist. Run before shipping changes to recording, processing, prompts, import, settings, or quit behavior.
- [`docs/private_plans/chat-architecture.md`](docs/private_plans/chat-architecture.md) — Why the meeting-index is shaped the way it is (writer path, FTS+vec schema, backfill, engine retrieval primitives consumed by MCP). Read before refactoring chunking, embedding, or citation playback. The in-app Chat UI described in earlier versions was removed in 2026-04 — the surface now lives in Claude Desktop via MCP.
- [`docs/private_plans/privacy-posture-analysis.md`](docs/private_plans/privacy-posture-analysis.md) — Complete outbound-network audit and defensible privacy claims. Read before changing any code that makes a network call or writing privacy-facing copy.
- [`docs/private_plans/release/`](docs/private_plans/release/) — Release/notarization/auto-update docs. Read [`release-playbook.md`](docs/private_plans/release/release-playbook.md) before cutting a release; [`DMG-bundling-and-update-system.md`](docs/private_plans/release/DMG-bundling-and-update-system.md) for the dependency inventory and bundling story before changing `package:mac`, bundled binaries, or `check-bundled-binaries.mjs`.

### Optional background — only if the task is explicitly about this area

- [`docs/private_plans/efficiency-improvements.md`](docs/private_plans/efficiency-improvements.md) — Identified perf bottlenecks (config cache, IPC fanout, SQLite migration). Reference only when the task is explicitly a perf improvement.
- [`docs/private_plans/notion-integration.md`](docs/private_plans/notion-integration.md) — Aspirational one-way Notion sync design. **Not yet implemented.**
- [`docs/private_plans/loom-style-screen-recording-investigation.md`](docs/private_plans/loom-style-screen-recording-investigation.md) — Exploratory investigation. **Nothing shipped.**
- [`docs/private_plans/parallel-agent-pool.md`](docs/private_plans/parallel-agent-pool.md) — Infrastructure setup for a local Claude Code agent pool. Meta, not app code.

## Plan Handling

- Stable repo instructions live in this `AGENTS.md`.
- Temporary implementation plans should live in the repo, preferably under `docs/plans/` if they need to persist across sessions.
- Files outside the repo, including items in `Downloads`, are advisory only unless their contents are explicitly pasted into the task or copied into the repo.
- Do not treat external plan files as canonical repo instructions.

## Current Product Direction

- Prioritize first-session value for a solo user over collaboration or team workflows.
- Preserve the local-first desktop workflow while allowing optional cloud services where already supported.
- Keep Obsidian as an integration layer rather than a required product dependency in app behavior or product framing.
- Future launch-polish work must preserve the recent stabilization work around scoped IPC and path validation, quit safety for recordings, live shortcut correctness, and Electron sandboxing unless a task explicitly changes one of those constraints.
