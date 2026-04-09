# Desktop Smoke Flow

Use this after local changes that touch recording, processing, prompts, or settings.

1. Launch the app with no active run.
2. Start a meeting, type notes while recording, then stop.
3. Open the finished meeting and verify `notes`, `transcript`, and prompt outputs load.
4. Reprocess one meeting from the detail view and confirm live progress updates appear.
5. Select multiple meetings from the Meetings list and run one prompt in bulk.
6. Change the global shortcut in Settings and confirm it works after restart.
7. Start a new recording and quit the app before stopping.
8. Relaunch and verify the interrupted meeting is preserved on disk with status `aborted`.
9. Open that aborted meeting and reprocess it manually.
10. Delete one run and verify only that run folder is removed.
