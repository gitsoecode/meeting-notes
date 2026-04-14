# Manual Smoke Test

Quick manual verification of core app flows. Run this after significant changes to recording, processing, or UI state management.

## Prerequisites

- App built: `npm run build --workspace @meeting-notes/app`
- Native modules rebuilt: `npm run rebuild:native --workspace @meeting-notes/app`
- A browser tab with a YouTube video or podcast playing (provides system audio)

## Launch

```bash
npm start --workspace @meeting-notes/app
```

---

## 1. Recording flow (the critical path)

### Start

1. Click **Start recording** on the Home screen
2. Give it a title like "Smoke test"
3. Click **Start recording**

### Verify during recording (10–15 seconds is enough)

- [ ] **Recording** status chip appears (red, pulsing dot)
- [ ] **Mic** audio meter is moving (picks up room noise)
- [ ] **System audio capturing** shown in green — if you see the amber "System audio not available" text or a yellow warning banner about permissions, go to System Settings → Privacy & Security → System Audio Recording and grant it, then restart the app
- [ ] Say a few words out loud so the mic captures something transcribable

### Pause / Resume (optional, worth checking once)

- [ ] Click **Pause** — chip changes to "Paused"
- [ ] Click **Resume** — chip returns to "Recording"

### Stop

1. Click **End meeting**
2. Verify end-meeting dialog shows transcript + summary checkboxes (both checked)
3. Click **Process and close**

### Verify processing state

- [ ] Lands on meeting workspace showing pipeline progress
- [ ] **Notes tab**: Shows "Notes will appear after processing completes." — NOT "No notes for this meeting"
- [ ] **Summary tab**: Shows "Summary is being generated…" with progress indicators
- [ ] Wait for processing to finish (30–60s with Parakeet)

### Verify completed state

- [ ] **Summary tab**: Rendered markdown with real content
- [ ] **Transcript tab**: Timestamped transcript with both your voice and YouTube/podcast audio (confirms system audio capture)
- [ ] **Notes tab**: Shows notes.md content with Edit button
- [ ] **Recording tab**: Audio players for mic.wav, system.wav, and combined.wav — play each to verify they're not silent
- [ ] **Analysis tab**: Auto-run prompts have output; others show "not produced yet" with Run button
- [ ] **Metadata tab**: Title, timestamp, duration look correct
- [ ] **Files tab**: Shows attachments directory

---

## 2. Meetings list

- [ ] Navigate to **Meetings** — all meetings appear with status badges
- [ ] Search filters the list
- [ ] Clicking a meeting opens the workspace
- [ ] Select-all checkbox + bulk run works

---

## 3. Settings

- [ ] **Audio tab**: Mic select opens and lists devices. System audio shows "Automatic (macOS 14.2+)" with permission hint
- [ ] **Models tab**: Default model dropdown works. API key save/clear works
- [ ] **Storage tab**: Data path shown. Move button opens picker
- [ ] **Other tab**: System Health table shows all dependency rows (ffmpeg, Python, Parakeet, whisper.cpp, Ollama). Keyboard shortcuts section visible

---

## 4. Import

- [ ] Drag an .mp4 or .wav file onto the Home screen (or use import button)
- [ ] Verify it creates a new meeting and begins processing

---

## 5. Prompt Library

- [ ] Navigate to **Prompt Library**
- [ ] Select a prompt — editor shows title, body, auto-run toggle
- [ ] Toggle auto-run and verify it saves
- [ ] Create a new prompt via the + button

---

## 6. Advanced flows

- [ ] Reprocess a meeting from the detail view and confirm live progress updates appear
- [ ] Select multiple meetings from the Meetings list and run one prompt in bulk
- [ ] Change the global shortcut in Settings and confirm it works after restart
- [ ] Start a new recording and quit the app before stopping — relaunch and verify the interrupted meeting is preserved on disk
- [ ] Delete one run and verify only that run folder is removed

---

## What to watch for

| Symptom | Likely cause |
|---------|-------------|
| Transcript only has your voice, not YouTube audio | System audio capture failed — check `~/.meeting-notes/app.log` for "System audio is silent" |
| `SQLITE_CONSTRAINT_UNIQUE` error in console | Started two recordings within the same minute (known edge case) |
| "No notes for this meeting" during processing | Build is stale — rebuild renderer |
| `combined.wav` missing from Recording tab | Mic+system merge failed — check run log via Activity |
| App crashes on start after running tests | Run `npm run rebuild:native --workspace @meeting-notes/app` |
| `ERR_DLOPEN_FAILED` / `NODE_MODULE_VERSION` | Same as above — native module mismatch |

---

## Shortcut version (subsequent tests)

Once the full flow is verified, the minimum smoke test is:

1. Start recording with YouTube playing
2. Talk for 5 seconds
3. Stop → Process
4. Confirm transcript has both your voice and the video audio
5. Confirm Summary tab populates after processing
