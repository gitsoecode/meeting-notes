# Efficiency Improvements Plan

This document covers performance bottlenecks identified in the app and groups them by when to address them: quick wins that can ship independently, and deeper changes that belong with the SQLite migration.

---

## Part 1: Independent Quick Wins (Ship Before or After SQLite)

These have no dependency on the SQLite work and can land as standalone PRs.

### 1.1 Config Caching

**Problem:** `loadConfig()` reads `~/.meeting-notes/config.yaml` from disk and YAML-parses it on every single IPC call. There are 50+ call sites across `ipc.ts`, `recording.ts`, `runs-service.ts`, `jobs.ts`, and `run-access.ts`. One reprocess-job setup (ipc.ts:237-245) calls `loadConfig()` five times in a row for the same request.

**Fix:** Create a `ConfigCache` singleton in `packages/app/main/` that:
- Loads config once on app startup
- Exposes `getConfig(): AppConfig` (returns cached value)
- Exposes `invalidate()` called from the `config:save` IPC handler
- Optionally watches `config.yaml` mtime on a 5s interval as a safety net for CLI-side edits

**Files:**
- New: `packages/app/main/config-cache.ts`
- Update: `packages/app/main/ipc.ts` — replace all `loadConfig()` calls with `getConfig()`
- Update: `packages/app/main/recording.ts` — same
- Update: `packages/app/main/runs-service.ts` — same
- Update: `packages/app/main/jobs.ts` — same
- Update: `packages/app/main/run-access.ts` — remove `config = loadConfig()` default params, require explicit arg

**Impact:** Eliminates ~50 redundant disk reads + YAML parses per session. Every IPC call gets faster.

### 1.2 Audio Device List Caching

**Problem:** `FfmpegRecorder.start()` spawns ffmpeg to enumerate audio devices to resolve a default mic name. Each ffmpeg spawn takes ~100-200ms on macOS. This adds latency to every "start recording" action.

**Fix:**
- Add an `AudioDeviceCache` in main that calls `listAudioDevices()` once at startup and caches the result
- Invalidate on settings change (mic/system device selection) or expose a manual refresh
- Pass the cached device list into `FfmpegRecorder.start()` as an optional param so it skips the enumeration spawns
- The `recording:list-audio-devices` IPC handler (ipc.ts:478) can return the cached list and trigger a background refresh

**Files:**
- New: `packages/app/main/audio-device-cache.ts`
- Update: `packages/engine/src/adapters/recording/ffmpeg.ts` — accept optional `knownDevices` param in `start()` and `isSystemCaptureAvailable()`
- Update: `packages/app/main/recording.ts` — pass cached devices to recorder
- Update: `packages/app/main/ipc.ts` — warm cache in `registerIpcHandlers()` or call from `index.ts` on ready

**Impact:** Cuts ~200-400ms from "start recording" latency. The user's most time-sensitive interaction.

### 1.3 Home Page: Limit Timeline to Recent Runs

**Problem:** The home page calls `api.runs.list()` which does a full recursive directory walk + YAML parse of every `index.md` in the `Runs/` tree. At 200+ meetings this is noticeably slow. The home page only shows recent meetings in a timeline — it doesn't need the full list.

**Fix:** Add a `runs:list-recent` IPC handler that:
- Walks only the last 2-3 date folders (e.g., current month + previous month) based on the `YYYY/MM/DD` directory structure
- Or: walks all folders but stops after finding N runs (since folders are date-sorted)
- Returns at most 20 `RunSummary` items

The full `runs:list` stays for the Meetings page. The home page and PromptsEditor switch to the limited version (PromptsEditor at `PromptsEditor.tsx:641` likely doesn't need the full list either).

**Files:**
- Update: `packages/app/main/ipc.ts` — add `runs:list-recent` handler
- Update: `packages/app/shared/ipc.ts` — add `listRecent` to runs API
- Update: `packages/app/preload/index.ts` — bridge
- Update: `packages/app/renderer/src/routes/RecordView.tsx` (or `HomePage.tsx` post-migration) — use `listRecent`
- Update: `packages/app/renderer/src/routes/PromptsEditor.tsx` — use `listRecent`

**Impact:** Home page loads faster by only scanning recent date folders instead of the entire history.

### 1.4 Deduplicate Redundant `loadRunManifest` in Recording Flows

**Problem:** Several recording functions read the manifest, check a condition, then call `updateRunStatus()` which reads the manifest again internally. For example `startRecordingForDraft` (recording.ts:468-476):
```ts
const manifest = loadRunManifest(validated);       // read 1
if (manifest.status !== "draft") throw ...;
updateRunStatus(validated, "recording", { ... });  // read 2 (inside updateRunStatus)
```

Same pattern in `resumeRecording`, `continueRecording`, `pauseRecording`.

**Fix:** Add an `updateRunStatusFrom(folderPath, manifest, status, updates)` variant that accepts an already-loaded manifest instead of re-reading it. Or refactor `updateRunStatus` to accept an optional pre-loaded manifest.

**Files:**
- Update: `packages/engine/src/core/run.ts` — add manifest param to `updateRunStatus`
- Update: `packages/app/main/recording.ts` — pass pre-loaded manifests

**Impact:** Eliminates one redundant file read + YAML parse per recording state transition. Small but removes unnecessary I/O on a latency-sensitive path.

---

## Part 2: Bundle with SQLite Migration

These changes are either enabled by SQLite or naturally overlap with the migration's file surface area.

### 2.1 `runs:list` Becomes a SQL Query

**Problem:** `walkRunFolders()` (ipc.ts:186-209) recursively walks the entire `Runs/` directory tree, then the loop at line 517-532 reads and YAML-parses every `index.md` found. This is O(n) in total meetings and is the single biggest bottleneck for app startup and the Meetings page.

**Fix with SQLite:**
```sql
SELECT run_id, title, description, date, started, ended, status,
       source_mode, duration_minutes, folder_path, scheduled_time
FROM runs
ORDER BY started DESC;
```

One indexed query replaces the entire walk + parse loop. Filtering by date, status, or tags becomes trivial (`WHERE status = 'draft'`, `WHERE date > ?`).

The 10-second polling in `MeetingsList.tsx:86` (`api.runs.list()` during processing) also becomes cheap instead of re-walking the filesystem.

**Files:**
- Update: `packages/app/main/ipc.ts` — `runs:list` handler reads from DB
- Delete: `walkRunFolders()` function (or keep as rebuild-index fallback)
- The `runs:list-recent` handler from 1.3 becomes unnecessary (SQL handles `LIMIT` natively)

### 2.2 Atomic State Updates (Eliminate Read-Modify-Write)

**Problem:** Every call to `updateRunStatus()` and `updateSectionState()` in `packages/engine/src/core/run.ts` does a full read-parse-modify-serialize-write cycle on `index.md`. If two section completions arrive close together, one can clobber the other.

**Fix with SQLite:**
```sql
-- updateRunStatus
UPDATE runs SET status = ?, ended = ?, duration_minutes = ? WHERE run_id = ?;

-- updateSectionState
INSERT OR REPLACE INTO sections (run_id, section_id, status, filename, label, error, latency_ms, tokens_used)
VALUES (?, ?, ?, ?, ?, ?, ?, ?);
```

Atomic, no race conditions. After each DB write, regenerate `index.md` as a non-blocking side effect for Obsidian compatibility.

**Files:**
- Rewrite: `packages/engine/src/core/run.ts` — `loadRunManifest`, `updateRunStatus`, `updateSectionState` read/write DB
- New: `packages/engine/src/core/db.ts` — schema, migrations, query helpers
- Keep: `writeManifest()` as a one-way index.md generator (write-only, never read back)

### 2.3 `loadRunManifest` Becomes a SQL Read

**Problem:** There are 30+ call sites across the codebase that call `loadRunManifest(folderPath)`, each doing a file read + YAML parse. Many of these happen on hot paths (recording state checks, job scheduling, detail views).

**Fix with SQLite:**
```sql
SELECT * FROM runs WHERE folder_path = ?;
-- plus
SELECT * FROM sections WHERE run_id = ?;
```

The function signature stays the same (`loadRunManifest(folderPath): RunManifest`) so all 30+ call sites work unchanged. The implementation swaps from gray-matter to a DB query.

**Files:**
- Update: `packages/engine/src/core/run.ts` — reimplement `loadRunManifest`
- No changes needed in callers (ipc.ts, recording.ts, runs-service.ts, jobs.ts, pipeline.ts)

### 2.4 Sections, Attachments, Segments as Proper Tables

**Problem:** `RunManifest.sections` is a `Record<string, SectionState>`, `attachments` and `recording_segments` are string arrays — all serialized into YAML frontmatter. These are relational data crammed into a document format, making queries impossible and serialization fragile.

**Fix with SQLite:**
```sql
CREATE TABLE sections (
  run_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  filename TEXT NOT NULL,
  label TEXT,
  builtin INTEGER DEFAULT 0,
  error TEXT,
  latency_ms INTEGER,
  tokens_used INTEGER,
  completed_at TEXT,
  PRIMARY KEY (run_id, section_id),
  FOREIGN KEY (run_id) REFERENCES runs(run_id)
);

CREATE TABLE attachments (
  run_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  size INTEGER,
  PRIMARY KEY (run_id, filename),
  FOREIGN KEY (run_id) REFERENCES runs(run_id)
);

CREATE TABLE recording_segments (
  run_id TEXT NOT NULL,
  segment_name TEXT NOT NULL,
  sort_order INTEGER,
  PRIMARY KEY (run_id, segment_name),
  FOREIGN KEY (run_id) REFERENCES runs(run_id)
);
```

This enables queries like "which runs have failed sections?" or "total tokens used this month" without loading every manifest.

### 2.5 Rebuild-from-Filesystem Command

**Essential companion to SQLite.** A `rebuildIndex()` function that:
- Walks `Runs/` using the existing `walkRunFolders` logic
- Parses each `index.md` with gray-matter
- Upserts into the DB

This serves as:
- The one-time migration from YAML-only to SQLite
- A recovery tool if the DB gets corrupted or deleted
- A portable story: user copies their Runs folder to a new machine, opens the app, index rebuilds automatically

**Files:**
- New: `packages/engine/src/core/db-rebuild.ts`
- Update: `packages/app/main/ipc.ts` — add `db:rebuild` handler (or auto-detect on startup)

---

## Suggested Execution Order

```
1. Config caching (1.1)              — standalone PR, immediate win
2. Audio device caching (1.2)        — standalone PR, fixes "slow start recording"
3. Deduplicate manifest reads (1.4)  — standalone PR, small cleanup
4. Limit home timeline (1.3)         — standalone PR, faster home page

  --- MeetingWorkspace migration ships here ---

5. SQLite schema + DB layer (2.2, 2.4)        — foundation
6. Migrate loadRunManifest to DB (2.3)         — swap implementation
7. Migrate runs:list to SQL (2.1)              — biggest perf win
8. Rebuild-from-filesystem (2.5)               — migration + recovery
9. Generate index.md as write-only side effect  — Obsidian compat
```

Steps 1-4 can ship in any order and are independent of each other.
Steps 5-9 are the SQLite migration and should ship as one coordinated effort.
