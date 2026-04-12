# AGENTS.md

## Project Identity

Meeting Notes is a local-first desktop meeting workspace for solo power users. The product is a desktop app first. Obsidian is an optional integration layer, not a required mode. The core value is editable markdown, local control, and customizable prompt-driven outputs.

## Repo Map

- `packages/app`
  Electron desktop app, preload bridge, IPC layer, renderer flows, and app-specific tests.
- `packages/engine`
  Shared core for config, recording, transcription, prompt loading, run processing, and filesystem layout.
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

- Build and regression-check with `npm test`.
- Read `docs/testing-playbook.md` before changing app flows, Playwright fixtures, page objects, IPC-backed UI behavior, or run-lifecycle behavior.
- Use `docs/smoke-flow.md` for manual QA when changing app flows such as recording, reprocessing, prompts, import, settings, or quit behavior.
- For app changes, prefer this test sequence unless the task clearly calls for something narrower:
  1. `npm run test --workspace @meeting-notes/app`
  2. targeted Playwright specs for the changed area
  3. `npm run test:e2e --workspace @meeting-notes/app`
  4. `npm test`
- For UI changes, the default testing bar is action completeness, not route render:
  - cover visible buttons, menus, tabs, dropdowns, row actions, bulk actions, and modal confirm/cancel paths on affected pages
  - prefer page-object and semantic assertions over brittle global text checks
  - if a page is stateful or run-scoped, add at least one resilience-path test
- Keep Playwright’s `mock-api.ts`, shared fixtures, and page objects aligned with real app behavior. If a feature changes route behavior, IPC semantics, or meeting-state transitions, update the test harness in the same task.
- Add or update resilience coverage for run-scoped features that can encounter stale, missing, partial, or interrupted state.
- Prefer small shared helpers over growing `packages/app/main/ipc.ts` with more business logic.
- For renderer UI work, prefer `shadcn/ui` primitives and composition patterns as the default approach. Favor extending the shared component layer under `packages/app/renderer/src/components/ui` over introducing new bespoke controls or one-off styling patterns.
- When changing user-facing product copy, preserve the current positioning unless the task explicitly changes it:
  `desktop app`, `Obsidian optional`, `local-first`, `editable markdown`, `customizable outputs`.

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
