# Notarization checkpoint — 2026-04-25

> **Historical snapshot — superseded.** This document records the *first* notarization attempt and the state mid-flight. The pipeline has since shipped (`v0.1.0-notarized-20260426`, `v0.1.1-notarized-20260426`) and many of the issues described as "in flight" here have been resolved. For the current release process, see [release-playbook.md](./release-playbook.md). This file is preserved for the audit trail of the first submission.

This note records the first Apple Developer ID notarization attempt for
Gistlist. At the time of this checkpoint, no Gistlist build has ever been
notarized for this Apple Developer team.

## Source and branch

- Branch used for the release build: `pre-beta-hardening`
- Source commit used for the packaged app: `2cc3190`
- Commit subject: `Phase 11: pre-beta release rollup — packaging pipeline + in-flight feature/security work`

## Submitted Gistlist artifacts

### Original electron-builder submission

- Submission ID: `e0c7cfbd-e19d-4cd9-a79f-584c8cdfc4ff`
- Name reported by Apple: `Gistlist.zip`
- Created: `2026-04-25T17:54:03.343Z`
- Status at checkpoint: `In Progress`
- Notes: electron-builder submitted this zip, then local polling failed with a network error.

### Corrected Gistlist submission

- Submission ID: `e2db4718-e10e-48eb-9e32-b6afd9a31e47`
- Name reported by Apple: `Gistlist-0.1.0-arm64-notary-submit.zip`
- Created: `2026-04-25T19:37:32.464Z`
- Status at checkpoint: `In Progress`
- Local app path: `packages/app/release/mac-arm64/Gistlist.app`
- Notes: this submission used the same packaged app lineage from `2cc3190`, then manually re-signed `Contents/MacOS/audiotee` with `com.apple.security.inherit` before zipping and submitting.

## Smoke-test submission

- Submission ID: `fd1a1276-f5ab-4dbd-b037-e0661b33bfc3`
- Name reported by Apple: `NotarySmoke.zip`
- Created: `2026-04-25T20:17:38.900Z`
- Status at checkpoint: `In Progress`
- Notes: tiny control app built in `/tmp/gistlist-notary-smoke` using a copied system executable, minimal `Info.plist`, Developer ID signature, and hardened runtime. This exists to distinguish Gistlist bundle issues from first-time account/notary latency.

## Release-pipeline fixes made after the submitted source commit

- `packages/app/scripts/after-sign.mjs`
  - Fixes signing-identity resolution.
  - Verifies `Contents/MacOS/audiotee` has `com.apple.security.inherit`.
- `packages/app/scripts/notarize-release.mjs`
  - Moves notarization after the AudioTee `afterSign` repair.
  - Supports resuming an existing submission ID without creating another submission.
- `packages/app/package.json`
  - Runs electron-builder signing with `--config.mac.notarize=false`, then calls the explicit notarization script.
- `packages/app/scripts/check-notarize-env.mjs`
  - Validates keychain-profile notarization auth.
- `packages/app/scripts/package-with-engine-staged.mjs`
  - Always re-stages `@gistlist/engine` from clean and restores the workspace symlink.

## Verification state at checkpoint

- Corrected local `Gistlist.app` passes `codesign --verify --deep --strict`.
- Corrected local `Contents/MacOS/audiotee` contains `com.apple.security.inherit: true`.
- `spctl --assess --type execute` still rejects the app as `Unnotarized Developer ID`.
- `xcrun stapler validate` cannot pass until Apple accepts a submission and the ticket is stapled.

## Resume commands

```bash
xcrun notarytool history --keychain-profile gistlist-notary --output-format json
xcrun notarytool info e2db4718-e10e-48eb-9e32-b6afd9a31e47 --keychain-profile gistlist-notary
```

If the corrected Gistlist submission is accepted:

```bash
xcrun stapler staple packages/app/release/mac-arm64/Gistlist.app
xcrun stapler validate packages/app/release/mac-arm64/Gistlist.app
cd packages/app/release/mac-arm64
ditto -c -k --keepParent --sequesterRsrc Gistlist.app ../Gistlist-0.1.0-arm64-mac.zip
```
