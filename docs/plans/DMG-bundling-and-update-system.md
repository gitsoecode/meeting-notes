# DMG Bundling & Update System — Notes for the Packaging Agent

## Dependency Inventory

Everything the app needs at runtime, how it gets there today, and what the update story looks like.

| Dependency | Source today | Bundleable? | Version tracking | Update path today |
|---|---|---|---|---|
| **Electron shell** | `electron@^41.2.0` in devDeps | N/A — it IS the app | Build-time only | Ship new `.app` |
| **Ollama binary** | `resources/bin/ollama` (bundled) or system PATH | Yes — already bundled | None | Frozen at build (bundled) / user manages (system) |
| **ffmpeg** | System PATH only (not bundled yet) | Yes — static binary | None | User runs `brew upgrade` |
| **whisper-cli** | System PATH via `brew install whisper-cpp` | Yes — static binary | None | User runs `brew upgrade` |
| **Parakeet MLX** | Python venv at `~/.meeting-notes/parakeet-venv/` via `setup-asr.ts` | No — ~2GB, Python + pip + mlx-audio | None | "Check / repair" button reinstalls |
| **Python 3.11+** | Expected on PATH (macOS ships 3.9) | No (or heavyweight) | None | User manages |
| **BlackHole 2ch** | `brew install --cask blackhole-2ch` — kernel audio driver | No | None | User manages |
| **Ollama models** | `~/.ollama/models/` via `/api/pull` | No — user data | Tags only | User re-pulls |
| **LLM model catalog** | Hardcoded `llm-catalog.ts` | N/A — source code | Frozen at build | Ship new `.app` |
| **better-sqlite3** | npm dep, native C++ addon | Compiled at build | Build-time | `electron-rebuild` |
| **@napi-rs/keyring** | npm dep for macOS Keychain | Pre-built binaries | Build-time | npm update |

**Key takeaway:** The app has zero self-update capability today — no `electron-updater`, no version checking, no update banner. The model catalog is hardcoded and frozen at build.

## What Already Works

- `bundled.ts` resolves `Contents/Resources/bin/<name>` when `app.isPackaged` is true, falls back to `resources/bin/` in dev.
- `electron-builder` config in `packages/app/package.json` → `"build"` key copies `resources/bin/` → `Contents/Resources/bin/`.
- `check-bundled-binaries.mjs` is a preflight gate run by `package:mac` — currently only checks ollama. Easy to extend.
- `ollama-daemon.ts` gracefully resolves: system-running → system-spawned → bundled-spawned. System installs always win.
- `deps:check` IPC handler auto-detects all deps on load and Settings → System Health card shows their status.
- The `ModelDropdown` already partially merges installed Ollama models with the hardcoded catalog (lines 56-72 of `ModelDropdown.tsx` — adds any installed model not in the static list). But the curated list still gates the "recommended" section.
- Settings → Local Models already lets users type any model name and pull it via `allowCustom`. The `pullOllamaModel` function in `ollama.ts` accepts arbitrary tags.

## Bundling Gotchas

1. **No codesigning/notarization yet.** The electron-builder mac config has icon + category but no signing identity, entitlements, or notarization. Unsigned DMGs trigger Gatekeeper on every launch. Need Apple Developer account, hardened runtime entitlements (minimum `com.apple.security.cs.allow-unsigned-executable-memory` for native modules), and `electron-builder`'s `afterSign` notarization hook.

2. **Hardened runtime + spawning binaries.** Bundled ollama/ffmpeg/whisper-cli are unsigned third-party binaries. Under hardened runtime, macOS may block them. Either codesign them with your identity before packaging, or use `com.apple.security.cs.disable-library-validation` entitlement (less ideal).

3. **`sandbox: true` is a repo guardrail** (see `AGENTS.md`). The Electron renderer is sandboxed. All filesystem/process access goes through preload → main process IPC. Do not disable it for packaging convenience.

4. **Native module ABI.** `better-sqlite3` must be compiled for Electron's Node ABI, not system Node. The `rebuild:native` script handles this. After `npm test` (which rebuilds for Node ABI), re-run `rebuild:native` before packaging.

5. **Universal binary (arm64 + x86_64).** All bundled binaries need universal/fat binaries if targeting both architectures. Native modules need compilation for both. `electron-builder --universal` roughly doubles app size.

6. **Parakeet's Python dependency is the hardest problem.** On a fresh Mac with no Homebrew and no Python 3.11+, Parakeet won't work without significant user action. Options:
   - (a) Bundle a minimal Python runtime (~100MB+ but removes the dep)
   - (b) Detect and offer to install Homebrew + Python via existing `deps:install` IPC
   - (c) Default fresh installs to whisper-cpp (fully bundleable) and make Parakeet a "power user" option
   The UI already handles the "not installed" state gracefully with an install button.

7. **First-launch experience.** Both the SetupWizard and Settings auto-detect deps. A fresh DMG install with bundled ollama + ffmpeg + whisper-cli shows most things green on first launch. Make sure both paths work — wizard for first run, settings for later.

## Update System Design

### Design principles (aligned with AGENTS.md)

- **Local-first = offline-capable, not offline-only.** The app must work with zero network calls. Update checks are opt-in and degrade gracefully.
- **No silent network calls.** If the app phones home, the user explicitly enabled it.
- **The user's system install wins.** Never clobber or shadow a system Ollama/ffmpeg.
- **Ollama IS the model catalog.** Stop maintaining a hardcoded local-model list; read ground truth from Ollama's API.

### Model catalog — merge with Ollama local state

The current `llm-catalog.ts` maintains a hardcoded `LLM_MODELS` array with five Ollama entries including `sizeGb` and `minRamGb`. This freezes at build time and can't pick up models the user pulls manually (unless they happen to match a known entry).

**Target design — split into two concerns:**

```
llm-catalog.ts
├── CLOUD_MODELS[]          # Claude, OpenAI — still hardcoded (we control these)
└── RECOMMENDED_LOCAL[]     # Just ids + blurbs, NOT a gating mechanism
                            # e.g. { id: "qwen3.5", blurb: "Good for transcripts" }
```

**How the dropdown should work:**

1. **Installed models** — fetched from Ollama `/api/tags`. Always appear, always selectable. This is the ground truth. Use `/api/show` to get metadata (parameter count, family, quant level) instead of hardcoding `sizeGb`/`minRamGb`.
2. **Recommended models** — small static list shipped with the app. Appear as suggestions with a "Pull" affordance when not installed. Hints, not a gate.
3. **Custom input** — already works via `allowCustom`. User types any Ollama tag and pulls it.

**Key files to change:**
- `packages/app/shared/llm-catalog.ts` — drop local model `sizeGb`/`minRamGb`, restructure into `CLOUD_MODELS` + `RECOMMENDED_LOCAL`
- `packages/app/renderer/src/components/ModelDropdown.tsx` — regroup: Installed → Recommended (uninstalled) → Custom
- `packages/engine/src/adapters/llm/ollama.ts` — add `getOllamaModelInfo(model)` wrapping `/api/show` for metadata
- `packages/app/main/model-validation.ts` — has its own duplicated `LOCAL_MODEL_ALIASES` and `normalizeModelId` — consolidate with `llm-catalog.ts`

**Why no remote catalog JSON:** Users discover models through Ollama's website, blog posts, etc. Our job is to show what's installed and make pulling trivial.

### Bundled version manifest

Ship a `versions.json` inside the app bundle (generated at build time):

```jsonc
// Contents/Resources/versions.json
{
  "app": "0.2.0",
  "built": "2026-04-10T00:00:00Z",
  "ollama": "0.9.1",
  "parakeetModel": "mlx-community/parakeet-tdt-0.6b-v2",
  "minimumOllama": "0.5.0",
  "channel": "stable"
}
```

Purpose: offline the app always knows its own versions and can warn if Ollama is below `minimumOllama`. Online (opt-in) it compares against a remote latest.json.

### Component-level version awareness

Each runtime dependency should report its version for the System Health card.

**Ollama version:** `/api/version` returns `{ version: "0.9.1" }`. The existing `pingOllama` hits this endpoint but discards the body. Add a `getOllamaVersion()` helper.

**Extend `DepsCheckResult`** — currently `ffmpeg` and `python` are `string | null` (just the path). Change to `{ path, version } | null`. Add `ollama.version` and an `app` section from `versions.json`. This is a breaking IPC change — the renderer reads `deps.ffmpeg` as a string in Settings.tsx line 189. Update both sides together.

### App update check (opt-in)

**Config addition to `AppConfig` (in `packages/engine/src/core/config.ts`):**

```typescript
updates?: {
  check_enabled: boolean;         // default false — user opts in
  check_interval_hours: number;   // default 168 (weekly)
  last_checked?: string;          // ISO timestamp
  dismissed_version?: string;     // user said "skip this version"
  include_prerelease: boolean;    // default false
}
```

**When enabled:** on app launch, if interval elapsed, `GET` a single remote URL → compare with bundled `versions.json` → show non-modal banner in Settings if newer. Store `last_checked`. No auto-download — user downloads `.dmg` manually. No network calls at all when `check_enabled` is false (the default). "Check now" button works even when toggle is off as a one-shot manual check.

### Settings UI for updates

New section in Settings → General, below Keyboard Shortcuts. Use existing shadcn `Card`, `Switch`, `Select`, `Button`.

```
Software Updates
Control how the app checks for newer versions.

Check for updates              [toggle: off by default]
Check frequency                [weekly ▼]

App version     0.2.0 (built 2026-04-10)
Ollama          0.9.1 (bundled)
Last checked    never

ℹ When disabled, the app makes zero network requests
  for update checking. You can always check manually.

[Check now]
```

### System Health card enhancements

The existing deps table gains version numbers and warning states:

```
Ollama        0.9.1 (bundled)                   ✓
              ⚠ v0.12.0 recommended

ffmpeg        7.1 (/opt/homebrew/bin)            ✓

Parakeet      installed 2026-03-15               ✓

Meeting Notes 0.2.0 (built 2026-04-10)
              ⚠ 0.3.0 available — download       [only if check_enabled]
```

## What NOT to Build

1. **Remote model catalog JSON.** Merge with Ollama local state instead.
2. **Auto-download of Ollama binary updates.** Security/signing issues. Show version warning when old.
3. **Auto-update for Parakeet.** "Check / repair" already reinstalls. Version tracking is enough.
4. **Full Sparkle/electron-updater integration.** Overkill. Banner + download link is simpler and respects user control.

## Implementation Order

### Phase A — Bundling (ship a working DMG)
1. Add ffmpeg and whisper-cli to `BundledBinary` type in `bundled.ts` and to `check-bundled-binaries.mjs`
2. Add bundled-binary fallback in the whisper-local adapter (like `ollama-daemon.ts` checks `bundledBinExists`)
3. Set up codesigning + notarization in electron-builder config
4. Create a build script: download platform binaries → `resources/bin/` → `electron-rebuild` → `electron-builder`
5. Generate `versions.json` at build time from package.json + binary versions
6. For deps that can't be bundled (Python, BlackHole), ensure Homebrew detection/install works on a fresh system via `deps:install` IPC

### Phase B — Model catalog refactor
7. Refactor `llm-catalog.ts`: split into `CLOUD_MODELS` + `RECOMMENDED_LOCAL`, drop hardcoded `sizeGb`/`minRamGb`
8. Add `getOllamaVersion()` and `getOllamaModelInfo()` to `ollama.ts`
9. Update `ModelDropdown` to group: Installed → Recommended → Custom
10. Consolidate duplicate `normalizeModelId`/`LOCAL_MODEL_ALIASES` between `llm-catalog.ts` and `model-validation.ts`

### Phase C — Version awareness & update system
11. Extend `DepsCheckResult` with version info (both sides of IPC)
12. Enhance System Health card with versions + warnings
13. Add `updates` section to `AppConfig` with defaults
14. Build the update check handler (single fetch, compare, store result)
15. Add Software Updates section to Settings → General UI
