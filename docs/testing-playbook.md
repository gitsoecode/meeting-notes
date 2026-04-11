# Testing Playbook

Use this playbook when changing Meeting Notes app flows, IPC behavior, renderer state handling, or the Playwright test harness.

## Goals

The test system should answer three questions:

1. Does the code still work at the unit and integration level?
2. Does the user-facing workflow still work end to end?
3. Does the app fail gracefully when state is stale, missing, partial, or interrupted?

For this repo, that means combining:

- `npm test` for the repo-wide build and app test gate
- app-level unit and integration coverage
- Playwright coverage for real UI flows and route transitions
- manual smoke verification for native desktop behavior that mocks cannot fully prove

## Default Test Sequence

For most app changes, run tests in this order:

1. `npm run test --workspace @meeting-notes/app`
2. targeted Playwright specs for the area you changed
3. `npm run test:e2e --workspace @meeting-notes/app`
4. `npm test`
5. `docs/smoke-flow.md` when the change touches recording, import, reprocessing, settings, quit safety, or prompt execution

This sequence keeps fast feedback early and still ends with the full release gate.

## Which Tests To Run

### Repo-wide gate

- `npm test`

Use this before shipping. It verifies the monorepo build plus the app tests.

### App unit and integration gate

- `npm run test --workspace @meeting-notes/app`

Use this whenever changing:

- SQLite store behavior
- IPC handler behavior
- config loading and caching
- device enumeration and caching
- path validation
- meeting lifecycle helpers

Important:

- This command now runs `packages/app/scripts/ensure-better-sqlite3.mjs` first.
- That script checks whether `better-sqlite3` can load for the current Node runtime and rebuilds it with `/usr/bin/python3` if the local binary ABI is wrong.
- If app tests fail before running assertions, check that script and the local native-module environment before assuming the product code is broken.

### Full E2E gate

- `npm run test:e2e --workspace @meeting-notes/app`

This is the main end-to-end release gate for renderer and route behavior.

The suite exercises:

- home and recording flows
- meetings list flows
- meeting detail flows
- prompt library flows
- settings and setup flows
- activity/log flows
- lifecycle state transitions
- resilience and failure-path behavior

## Targeted Playwright Specs

When iterating on one area, run the smallest useful slice first.

### Home and recording

- `packages/app/playwright/specs/home-recording.spec.ts`

Use for:

- starting, stopping, and deleting recordings
- import entry points
- end-meeting dialog changes
- live recording UI

### Meeting detail

- `packages/app/playwright/specs/meeting-detail.spec.ts`

Use for:

- tabs
- notes, transcript, files, and recording views
- detail-page actions
- re-open and delete flows

### Meetings list

- `packages/app/playwright/specs/meetings-list.spec.ts`

Use for:

- search
- selection
- bulk actions
- row status and navigation

### Meeting lifecycle

- `packages/app/playwright/specs/meeting-lifecycle.spec.ts`

Use for:

- `recording -> draft`
- `recording -> processing -> complete`
- `complete -> draft -> recording/process`
- bulk delete
- persisted re-entry paths

### Resilience and failure paths

- `packages/app/playwright/specs/resilience.spec.ts`

Use for:

- stale DB rows
- missing run folders
- missing attachments directory
- missing documents
- prompt-output failures

Every run-scoped feature should have at least one resilience test if it can fail due to missing, stale, or partial state.

### Prompt library

- `packages/app/playwright/specs/prompts-editor.spec.ts`

Use for:

- prompt creation and editing
- save/reset flows
- prompt-run affordances
- dirty-state behavior

### Navigation and UX coverage

- `packages/app/playwright/specs/navigation.spec.ts`
- `packages/app/playwright/specs/ux-audit.spec.ts`

Use for:

- route transitions
- sidebar behavior
- mobile/narrow layout behavior
- dialog accessibility
- overall UX consistency

## How Playwright Is Structured

The Playwright layer is designed around three pieces that should stay aligned.

### 1. Shared mock contract

File:

- `packages/app/playwright/mock-api.ts`

This file is the test-side behavior model of the app. It should match current IPC and route semantics closely enough that E2E failures reflect real regressions instead of stale fixtures.

When you change app behavior, update this file if the change affects:

- run creation
- run listing, lookup, deletion, or pruning
- recording lifecycle
- prompt-output lifecycle
- file/document loading
- settings or dependency status

Prefer extending existing mock behavior over inventing one-off fixtures inside a spec.

### 2. Shared fixture bootstrap

File:

- `packages/app/playwright/fixtures/base.fixture.ts`

This file installs the mock API and creates the shared page objects.

Important:

- bootstrap uses `AppPage.bootstrapHome()`
- the fixture will retry initial Home boot once if the first renderer load stalls
- this is intentional hardening against transient startup timing, not a license to ignore flaky route waits elsewhere

If a spec fails during fixture setup, inspect the shared bootstrap path before modifying individual specs.

### 3. Page objects

Files:

- `packages/app/playwright/pages/*.page.ts`

Use page objects to keep selectors stable and intent-focused.

Rules:

- prefer role-based or route-level selectors
- prefer helper methods over repeating raw selectors in specs
- avoid coupling tests to mutable marketing copy unless the copy is the thing under test
- add route-ready helpers when new screens or tabs are introduced

## Authoring New Tests

When adding a new feature, write tests in this order:

1. Add or update the page-object helper
2. Update `mock-api.ts` so the feature exists in the mock contract
3. Add one happy-path test
4. Add one resilience or recovery-path test if the feature touches runs, files, prompts, or background work
5. Add a reload or reopen assertion if the feature persists state

This keeps the suite readable and reduces selector drift.

## State-Machine Mindset

For meeting-related work, think in state transitions rather than screens.

Common states:

- `draft`
- `recording`
- `paused`
- `processing`
- `complete`
- `aborted`
- `deleted`
- complete-with-failed-output

For each new feature touching meetings, ask:

1. What state does the user start in?
2. What action do they take?
3. What state should they land in?
4. What happens if the backing folder, file, or prompt output disappears or fails mid-flow?
5. What happens after reload or reopen?

If a feature changes state, tests should verify both the forward path and a realistic failure or recovery path.

## Resilience Coverage Rules

Unexpected error paths are first-class test coverage, not optional cleanup work.

At minimum, add resilience coverage for features that depend on:

- `runFolder`
- filesystem-backed documents
- media files
- attachments
- prompt-output state
- background jobs

Good resilience scenarios:

- DB row exists but run folder is missing
- run folder exists but a child file is missing
- one prompt output fails while siblings succeed
- user sees stale list data and acts on it
- run disappears between list load and detail open

Assertions for resilience tests:

- no renderer crash
- no broken IPC channel
- no stuck loading spinner
- friendly empty state, redirect, or error
- unrelated meetings stay usable

## When A Failure Is Probably Test Drift

A failure is often test drift, not product breakage, when:

- multiple unrelated specs fail in fixture setup
- failures point to old UI copy or route labels
- a page object no longer matches current layout structure
- the mock API returns fields or states the renderer no longer uses

A failure is more likely a real app regression when:

- only one focused area fails
- unit/integration tests and E2E fail on the same behavior
- resilience tests start failing after a path-validation or run-lifecycle change
- user-visible state and mock state diverge in a reproducible way

## Manual Smoke Still Required

Playwright is strong, but it does not replace local native checks.

Use `docs/smoke-flow.md` for:

- interrupted recording on quit
- end-to-end local recording behavior
- media capture behavior
- shortcut verification after restart
- real filesystem preservation and deletion checks

Also do manual verification for:

- regenerated `index.md` readability in Obsidian
- performance spot checks with many meetings
- hardware- and environment-dependent recording behavior

## Recommended Workflow For Future Agents

When touching app flows:

1. Read this file.
2. Read `docs/smoke-flow.md` if the change affects recording, import, settings, prompts, or quit safety.
3. Update page objects and `mock-api.ts` together with the app behavior.
4. Run the smallest targeted Playwright slice that covers the changed flow.
5. Run the full app and repo gates before closing the task.
6. If the feature is stateful or run-scoped, add a resilience test before considering the work complete.

## Files Most Future Test Work Will Touch

- `packages/app/playwright/mock-api.ts`
- `packages/app/playwright/fixtures/base.fixture.ts`
- `packages/app/playwright/pages/*.page.ts`
- `packages/app/playwright/specs/*.spec.ts`
- `packages/app/scripts/ensure-better-sqlite3.mjs`

Keep those files healthy and aligned with the product. A reliable test stack is part of the product's stability work, not separate from it.
