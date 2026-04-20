# Changelog

All notable changes to Gistlist are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Version numbers follow SemVer.

## [Unreleased]

### Changed

- **Renamed the product from Meeting Notes to Gistlist.** Primary domain is `gistlist.app`, secondary `gistlist.co`. Legal entity (Gistlist, LLC) and license (FSL-1.1-ALv2) are unchanged.
- npm workspaces renamed from `@meeting-notes/*` to `@gistlist/*`.
- CLI binary renamed from `meeting-notes` to `gistlist`.
- Config directory moved from `~/.meeting-notes/` to `~/.gistlist/`.
- macOS Keychain service renamed from `meeting-notes` to `gistlist`.
- Electron `appId` changed from `com.meeting-notes.app` to `app.gistlist.desktop`; `productName` is now `Gistlist`.
- `MeetingNotesMark` component renamed to `GistlistMark`.
- `MeetingNotesApi` IPC interface renamed to `GistlistApi`.

### Added

- `docs/private_plans/brand-and-direction.md` — canonical brand doc covering product soul, voice rules, banned-word list, and design statement.
- `docs/private_plans/website-brief.md` — self-contained spec for the marketing site (separate repo).
- `docs/private_plans/naming-and-migration.md` — rename record, including local-install migration steps.
- Primary tagline in `README.md` and `AGENTS.md`: **"Your meetings stay on your machine."**

### Migration

Existing developer installs need a one-time migration after pulling this change. See [`docs/private_plans/naming-and-migration.md`](docs/private_plans/naming-and-migration.md) for the full checklist. Short form:

```bash
mv ~/.meeting-notes ~/.gistlist
npm install
npm run build
npm run rebuild:native --workspace @gistlist/app
npm link
gistlist set-key claude    # re-add keys — Keychain service name changed
gistlist set-key openai
```

macOS will re-prompt for microphone and system-audio permissions on the first launch because the bundle ID changed.
