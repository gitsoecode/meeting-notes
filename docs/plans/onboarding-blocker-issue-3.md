# Onboarding blocker — issue #3

Resolution plan for [issue #3 "Blocked during onboarding"](https://github.com/gitsoecode/meeting-notes/issues/3).

Reporter: Jamu Kakar. Two distinct problems:
1. **Permission asymmetry.** Step 4 auto-fires the system-audio probe (which indirectly triggers the macOS Screen & System Audio Recording TCC dialog) on step entry, but microphone permission is gated behind a button click. The auto-pop felt unexpected.
2. **Ollama install failure.** "Parakeet installed fine, but Ollama bailed after downloading files." We don't have the screenshot's `failedPhase` text, so we have to cover every post-download branch.

Branch: `claude/investigate-onboarding-blocker-B7RAn`.

---

## Part 1 — Permissions: consent-driven, sequenced

### Goal

Nothing in step 4 may trigger an OS permission dialog or run an automated probe purely as a side effect of landing on the step. Every dialog/probe must be initiated by an explicit user gesture. The mic check and the system-audio test are sequenced so the user understands what's about to happen.

### Current behavior

- `packages/app/renderer/src/routes/SetupWizard.tsx:263-287` — on `step === 4`, an effect calls `api.depsCheck()` and, if `systemAudioSupported`, immediately calls `probeSystemAudio()`. The probe (`packages/app/main/ipc.ts:753-818`, handler `system:probe-system-audio-permission`) plays Tink.aiff via `afplay` and tries to capture it via AudioTee — that capture attempt is what surfaces the macOS TCC dialog.
- Mic is read-only on mount (`getMicrophonePermission()`); `requestMicrophonePermission()` only fires when the user clicks the button at `SetupWizard.tsx:1409-1416`.

### Target behavior

A single sequenced flow under one section header ("Permissions") on step 4:

1. **Microphone** — status badge + "Grant microphone access" button. Clicking calls `requestMicrophonePermission()`. Required.
2. **System audio (optional, macOS 14.2+)** — status badge + a single primary button labeled `Test system audio` (replaces the current dual "Test again" / auto-probe behavior). Clicking calls `probeSystemAudio()`. The button copy and helper text make clear it will play a brief test tone and may prompt for screen-recording permission.

No `void probeSystemAudio()` on mount. No `requestMicrophonePermission()` on mount. The mount effect is reduced to **status reads only** — `depsCheck`, `getMicrophonePermission`, `getAppIdentity`, `checkBrew`. Those are fine to auto-run because they don't trigger dialogs and don't run subprocesses with side effects.

### Edits

- `packages/app/renderer/src/routes/SetupWizard.tsx:263-287`
  - Remove the auto-probe block (lines 267-275 inclusive of the comment). Keep the surrounding `depsCheck`, `checkBrew`, `getAppIdentity`, `getMicrophonePermission` reads — those are passive.
- `packages/app/renderer/src/routes/SetupWizard.tsx:1487-1517`
  - Adjust the system-audio "Not yet checked" empty state copy so the call-to-action button is the primary action when status is `unknown` (not just a "Test again" secondary). Single button labeled `Test system audio` for the unknown state, secondary `Re-test` once a verdict exists.
  - Add one-line helper copy under the badge: "Plays a short test tone and asks macOS for permission to capture system audio."
- `packages/app/renderer/src/routes/SetupWizard.tsx:1393-1427`
  - No structural change to the mic block, but reorder the page so **Microphone appears above System audio** (it's required; system audio is optional). Update the section's intro copy to set expectations: "Grant microphone access first. System audio is optional and only needed if you record meetings with other speakers playing through your speakers."
- Update the comment block at `SetupWizard.tsx:267-272` (currently justifying the auto-probe) — replace with a short note explaining the consent-first policy so the next reader doesn't reintroduce the auto-fire.

### Tests

- `packages/app/playwright/specs/setup-wizard.spec.ts` — add a spec asserting that on entry to step 4:
  - `system:probe-system-audio-permission` is **not** invoked
  - `system:request-microphone-permission` is **not** invoked
  - `system:get-microphone-permission` and `deps:check` **are** invoked
  - Clicking the mic grant button invokes the request handler
  - Clicking "Test system audio" invokes the probe handler
- Use the existing mock-api harness; this is a pure renderer change so the desktop project is sufficient.

---

## Part 2 — Ollama install failure: branch-by-branch

### Investigative summary

The install pipeline (`packages/app/main/installers/download.ts`) emits a `failedPhase` for every failure mode. The wizard renders it (`SetupWizard.tsx:349`). Without the screenshot we can't pick one branch, so we cover all of them. The phases that come *after* "downloading files" are:

| Phase | Where | Most plausible cause for Ollama 0.21.2 |
| --- | --- | --- |
| `verify-checksum` | `download.ts:404-411` | Manifest sha256 drift if the upstream tarball was re-released |
| `extract` | `download.ts:413-429` | `tar -xzf` failure on a partial/corrupt tarball |
| `verify-signature` | `download.ts:431-442` | `codesign --verify --deep --strict` rejecting the bundle |
| `verify-exec` | `download.ts:471-492` | Running `ollama --version` fails — dyld can't find sibling .dylibs, Gatekeeper translocation, arch mismatch |
| (post-install) daemon startup | `ollama-daemon.ts:41-137` | `ollama serve` doesn't answer `:11434` within 8 s; error swallowed by `.catch(() => {})` at `SetupWizard.tsx:355` |

We will (a) add diagnostics that tell us *exactly* which phase blew up next time, and (b) harden the two branches most likely to fail silently or fail spuriously.

### Edits — diagnostics first (lands in every branch)

1. **Stop swallowing the daemon-startup error.**
   `SetupWizard.tsx:351-356`. Change `await api.llm.check().catch(() => {})` to surface the failure into `installError` with a clear "Ollama installed but daemon failed to start" framing and a note pointing to `~/.gistlist/ollama.log`. The install row should still show "Installed", but the user should see *why* the LLM provider check is red.

2. **Persist the `failedPhase` in the app log.**
   `packages/app/main/ipc.ts` — in the `deps:install` handler, on a non-`ok` result, log via `appLogger.error("deps install failed", { tool, phase, error })` so post-mortem diagnosis doesn't depend on the user seeing the wizard toast.

3. **Verify the install manifest sha256 against the live upstream tarball.**
   One-time check: download `https://github.com/ollama/ollama/releases/download/v0.21.2/ollama-darwin.tgz`, compute SHA-256, confirm it equals `f14bb761dc3ef251a68081b4888920c187abe3ed53483db813ee8fb9c0a1af3e` at `manifest.ts:210-211`. If not, update the manifest. (Document the result in this plan.)

### Edits — per-branch fixes

#### Branch A — `verify-checksum`

If diagnostics step 3 above shows the sha256 has drifted, update `manifest.ts:210-211`. No code change otherwise; the existing pipeline correctly purges the stage and reports the failed phase.

#### Branch B — `extract`

Existing handler is correct (`download.ts:417-419`). One small improvement: include the first ~512 bytes of stderr from `tar` in the error message — already done via `runProc` (`download.ts:289-291`). No additional change required unless the screenshot points here.

#### Branch C — `verify-signature` (most likely culprit)

`codesign --verify --deep --strict` is strict by design and fails on Ollama bundles where:
- A sibling `.dylib` got truncated mid-download (would also fail checksum, but worth keeping in mind).
- The tarball was re-signed upstream after we pinned the sha256 (won't happen if checksum passes).
- macOS Sequoia's stricter resource-envelope rules reject older signatures.

**Fix:** keep `codesign --verify --deep --strict` as the gate (we don't want to silently accept a bad signature), but on failure capture and surface the codesign stderr — currently only the exit summary is shown.

- `packages/app/main/installers/download.ts:296-305` — the existing `verifySignature()` runs through `runProc` which already concatenates stderr into the rejected error (`download.ts:289-291`). Confirmed adequate. No change.
- New: when `verify-signature` fails, the wizard error block should render a follow-up suggestion: "Try the install once more. If it keeps failing, please share `~/Library/Logs/Gistlist/main.log`." Add to the `installError` rendering in `SetupWizard.tsx`.

#### Branch D — `verify-exec`

Most insidious mode: `ollama --version` exits non-zero because dyld can't load the sibling `.so`/`.dylib` files. Our pipeline runs `verifyExec` against the *staged* tree (`download.ts:474-477`), and the staged tree contains the binary plus siblings, so dyld resolution should work — *but* `runVerifyExec` may be running with a sanitized environment that strips `DYLD_*` paths or sets a sandboxed CWD.

- Read `packages/app/main/installers/verifyExec.ts` and confirm:
  - It runs the binary with `cwd` set to the staged runtime directory (so siblings resolve via `@loader_path`).
  - It does **not** scrub `HOME` (Ollama needs `HOME` to resolve `~/.ollama`).
  - It includes the staged runtime dir on `DYLD_FALLBACK_LIBRARY_PATH` if Ollama needs it (it generally doesn't because the binary uses `@loader_path`, but document and verify).
- If any of those are wrong, fix them.
- If the call already does the right thing, leave it alone — but ensure the captured `verifyResult.output` tail (`download.ts:489-490`) is making it into the wizard error (it does today; verify it's not truncated to the point of uselessness).

#### Branch E — daemon startup (`ensureOllamaDaemon` post-install)

Even when the install completes, `ensureOllamaDaemon()` (`ollama-daemon.ts:41-137`) can fail because:
- `ollama serve` cold-start on a slow disk exceeds the 8 s `PING_TIMEOUT_MS`.
- `:11434` is bound by something else (rare).
- The just-installed binary on macOS 15+ is in quarantine and needs first-launch user approval.

**Fix:**
- Bump `PING_TIMEOUT_MS` from 8000 to 20000 (`ollama-daemon.ts:10`). Cold start is observably slow on first run; 8 s is too aggressive.
- Surface the failure via the installError change in "diagnostics step 1" above.
- After install completes, strip the macOS quarantine xattr from the installed binary so first-launch isn't blocked by Gatekeeper. Add a step at the end of `downloadAndStage` (single-binary and preserve-tree both) that runs `xattr -dr com.apple.quarantine <finalPath>` best-effort, only on `darwin`. This is a small, well-scoped addition with low risk.
  - Edit: `packages/app/main/installers/download.ts` — after the atomic swap (`download.ts:497-541`), before the `emit({ phase: "complete" })` at line 557, add a `darwin`-only `xattr -dr com.apple.quarantine` over the install root (`finalPath` for single-binary, `runtime` for preserve-tree). Best-effort, swallow failures (xattr exits non-zero if there's no quarantine to remove, which is fine).
- Inspect `ollama-daemon.ts:72-105` for any env vars that should be set explicitly (e.g. `OLLAMA_MODELS` is intentionally left at default per the comment at `ollama-daemon.ts:38-39` — keep that). No change there.

### Tests

- **Unit (no Electron):** add a test for `downloadAndStage` that verifies, on `darwin`, the post-install xattr step runs against the correct path. Use a mocked `runProc`.
- **E2E (mock-backed Playwright):** extend `setup-wizard.spec.ts` to assert that when `deps.install("ollama")` resolves with `{ ok: true }` but `llm.check` rejects, the wizard renders an "Ollama installed but daemon failed to start" message rather than silently showing a green check. Today the failure is invisible.
- **Live electron (gated):** the `npm run test:e2e:electron` suite already exercises a real Ollama daemon. It is the right place to catch regressions in startup-timeout. No new spec required, but run the suite once before declaring done.

---

## Verification before merge

Per `AGENTS.md`:

1. `npm run test --workspace @gistlist/app` — app units.
2. `npm run test:e2e:focus --workspace @gistlist/app -- specs/setup-wizard.spec.ts` — iteration loop.
3. `npm run test:e2e --workspace @gistlist/app` — full mock-backed suite (desktop + narrow viewport).
4. `npm test` — repo-wide.
5. `npm run test:e2e:electron --workspace @gistlist/app` — required because we're touching SetupWizard flows and a real-Ollama-daemon code path.
6. `npm run rebuild:native --workspace @gistlist/app` — restore Electron-targeted `better-sqlite3` after tests.

Manual smoke (offer to user before running step 5):
- Fresh wizard run on a machine with mic permission `not-determined` — confirm no dialog pops on landing on step 4, mic dialog only appears on button click, system-audio TCC only appears when "Test system audio" is clicked.
- Re-install Ollama from the wizard — confirm install completes and the LLM row turns green; if daemon fails to start, the error is visible.

---

## Documentation

- Update `docs/private_plans/smoke-flow.md` SetupWizard section to reflect the new consent-driven flow (no auto-probe).
- The user-facing doc lives in the sibling `gistlist` repo at `web/src/content/docs/docs/setup-wizard.md` (per `AGENTS.md` cross-repo sync table). Update it in the same task or a paired PR — describe the two explicit buttons and the test-tone behavior.

---

## Out of scope

- Replacing AudioTee or moving to a different system-audio capture path.
- Bundling Ollama (the manifest already manages it as a downloaded tool).
- Migrating to a newer Ollama version — only update the pinned sha256 if upstream tarball drift is the actual cause.
