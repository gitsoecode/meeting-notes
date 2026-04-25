# Beta Release Checklist

This is the human-driven part of cutting the first signed beta build.
The agent's autonomous work stops at the end of Phase 6 in
`.claude/plans/wizard-install-for-ollama-mossy-snail.md`. Everything
below is for **you** to do — it requires Apple credentials and
account decisions that can't be automated.

Read all of §1 (Secure credential handling) before doing anything in
§2. The `.p8` file is the keys to your kingdom for signing — treat it
like a private key.

---

## 1. Secure credential handling (read first)

### What's sensitive — must never enter this repo

- **`AuthKey_<keyid>.p8`** — App Store Connect API key. Anyone with this
  file can sign packages as you for a year (or until you revoke it on
  developer.apple.com).
- **`APPLE_API_KEY_ID`** — 10-character key ID (visible alongside the
  `.p8` download).
- **`APPLE_API_ISSUER`** — UUID identifying your team. Slightly less
  sensitive than the key file, but still non-public.
- **The Developer ID Application certificate's private key** — lives
  in your macOS Keychain. **Never** export it to a file with
  `security export`. Exports go to disk; if you accidentally `git add`
  one, the cert is compromised.

### What's safe to commit

- `packages/app/main/build-flags.ts` content (`UPDATER_ENABLED`,
  `PUBLISH_PROVIDER`, `PUBLISH_REPO`). These are public flags. The
  file is gitignored anyway — generated from `package.json` on every
  build by `scripts/write-build-flags.mjs`.
- `packages/app/package.json`'s `build.publish` stanza pointing at the
  GitHub repo URL. Once the repo is public, the URL is public.
- The codesigning identity *name* (e.g.,
  `Developer ID Application: Gistlist, LLC (TEAMID)`). Apple treats
  this as public — anyone can read it from `codesign -dv` on the
  released DMG.

### Where the `.p8` file should live

Outside this repo. Recommended path: `~/.gistlist-secrets/`.

```sh
mkdir -p ~/.gistlist-secrets
mv ~/Downloads/AuthKey_*.p8 ~/.gistlist-secrets/
chmod 600 ~/.gistlist-secrets/*.p8
```

### Why no `.env` file

`.env` files drift into commits via global `git add` mistakes and IDE
indexing. We avoid them across the project. Three options for getting
credentials into `electron-builder`, in priority order:

#### Option A (recommended): notarytool keychain profile

This is the cleanest path. Apple's `notarytool` stores credentials in
your macOS Keychain under a profile name; `electron-builder` consumes
that profile by name without ever seeing the raw `.p8`.

```sh
xcrun notarytool store-credentials gistlist-notary \
  --key ~/.gistlist-secrets/AuthKey_<keyid>.p8 \
  --key-id <keyid> \
  --issuer <issuer-uuid>
```

Then in `packages/app/package.json` `build.mac` block, add:

```jsonc
"notarize": {
  "teamId": "<TEAMID>",
  "keychainProfile": "gistlist-notary"
}
```

Subsequent builds reference `gistlist-notary` by name. No env vars to
export, no creds in shell history, nothing on disk in this repo.

#### Option B: ephemeral shell exports

If keychain profiles don't work for your setup, `electron-builder`
also reads three env vars directly. Set them **only in the current
terminal session** — never in `~/.zshrc` or `~/.bash_profile`:

```sh
export APPLE_API_KEY=~/.gistlist-secrets/AuthKey_<keyid>.p8
export APPLE_API_KEY_ID=<keyid>
export APPLE_API_ISSUER=<issuer-uuid>

# … run the build …

unset APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER
```

The `check-notarize-env.mjs` preflight in `--sign` mode reads these
exact variables and fails fast with a clear message if any are
missing or malformed — so you'll know before electron-builder starts.

#### Option C (avoid): dotenv files

Don't. Even gitignored, they get checked in via `git add -A`
mistakes, copied into Time Machine backups, and indexed by IDEs.

### Pre-commit safety net (one-time setup)

Belt-and-suspenders against the "I just ran `git add -A`" failure
mode. Add a hook that refuses to commit any file matching `*.p8`,
`AuthKey_*`, or `~/.gistlist-secrets/`:

```sh
git config core.hooksPath .githooks
mkdir -p .githooks
cat > .githooks/pre-commit << 'EOF'
#!/usr/bin/env bash
set -euo pipefail
files="$(git diff --cached --name-only)"
if echo "$files" | grep -qE '(\.p8$|^AuthKey_|gistlist-secrets/)'; then
  echo "ERROR: refusing to commit credential-shaped file(s):"
  echo "$files" | grep -E '(\.p8$|^AuthKey_|gistlist-secrets/)'
  echo "If this is a false positive, edit .githooks/pre-commit or use --no-verify."
  exit 1
fi
EOF
chmod +x .githooks/pre-commit
```

### What ends up in the signed DMG

Nothing sensitive. The `.app` bundle contains:
- Your Developer ID team ID (public — visible to anyone with `codesign -dv`)
- Apple's notarization ticket (public)
- The Gistlist binary, AudioTee helper, and bundled assets

The `.p8` file does NOT end up in the DMG. The API key ID does NOT
end up in the DMG. The issuer UUID does NOT end up in the DMG. Apple
notarization is a server-side handshake — credentials authenticate
the upload but are not embedded in the artifact.

---

## 2. Build steps (after credentials are stored per §1)

1. **Confirm Developer ID Application cert is in Keychain:**

   ```sh
   security find-identity -v -p codesigning
   ```
   Should show one (or more) `Developer ID Application: Gistlist, LLC (TEAMID)`.

2. **Confirm notarytool keychain profile exists** (if using Option A):

   ```sh
   xcrun notarytool history --keychain-profile gistlist-notary
   ```
   Should run without prompting for credentials.

3. **Set `build.publish.repo` in `packages/app/package.json`** to the
   real GitHub repo:

   ```json
   "publish": {
     "provider": "github",
     "repo": "<owner>/<repo>"
   }
   ```

   This is what flips `UPDATER_ENABLED` to `true` at build time
   (via `scripts/write-build-flags.mjs`). Until you set a real repo,
   the updater stays inert and the UI surface is hidden.

4. **From the repo root, run the signed build**:

   ```sh
   # Option A — keychain profile already stored:
   npm run package:mac --workspace @gistlist/app -- --sign

   # Option B — ephemeral env vars:
   export APPLE_API_KEY=~/.gistlist-secrets/AuthKey_<keyid>.p8
   export APPLE_API_KEY_ID=<keyid>
   export APPLE_API_ISSUER=<issuer-uuid>
   npm run package:mac --workspace @gistlist/app -- --sign
   unset APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER
   ```

5. **Preflight runs first.** `scripts/check-notarize-env.mjs` is
   invoked by the `package:mac` chain when `--sign` is present. It
   verifies all three env vars (or the keychain profile equivalent)
   and confirms a Developer ID Application cert is in your keychain.
   On any failure it exits non-zero **before** electron-builder
   starts — you don't waste a notarization round-trip.

6. **electron-builder signs everything**, then `scripts/after-sign.mjs`
   re-signs `Contents/MacOS/audiotee` with `com.apple.security.inherit`
   (so AudioTee inherits the parent app's TCC permission). Without
   this, system audio capture silently records zeros.

7. **notarytool submits to Apple.** Typically takes 2–10 minutes.
   The build pauses at this step waiting for Apple's response.

8. **On success, the DMG lands at `packages/app/release/`.**

---

## 3. Verification

Run all four verification commands. None of them should produce
errors or warnings.

```sh
codesign --verify --deep --strict --verbose=2 \
  packages/app/release/mac/Gistlist.app

spctl --assess --type execute --verbose \
  packages/app/release/mac/Gistlist.app

codesign -dv --entitlements - \
  packages/app/release/mac/Gistlist.app/Contents/MacOS/audiotee
# Look for: com.apple.security.inherit → true

stapler validate packages/app/release/Gistlist-0.1.0-arm64.dmg
# (Or whatever the dmg filename ended up as.)
```

If any of these fail, do not distribute the DMG. Re-run the build
and re-verify.

---

## 4. Fresh-Mac smoke matrix (manual)

Run on at least the first cell, ideally all of them:

| Cell | Setup | Expected |
|---|---|---|
| Apple Silicon clean | New user, no Homebrew, no Ollama, no ffmpeg, no `~/.gistlist`, no `~/Documents/Gistlist` | Wizard completes, recording works |
| Apple Silicon dirty | Homebrew + ffmpeg + ollama already installed | Wizard surfaces them as `(system)`, offers clean-copy install |
| Intel clean | Only if Intel is in support matrix | Wizard completes, recording works |
| Offline mid-install | Pull network mid-download | Clear "Retry" UI, no `.partial` files visible |
| Quit during dependency download | ⌘Q while ffmpeg downloading | Relaunch shows clean state — no half-installed binary |
| Quit during meeting recording | ⌘Q while recording | Relaunch recovers per existing interrupted-run guardrail |

---

## 5. Publish to GitHub Releases

Don't publish from the unsigned-DMG flow — only sign-and-notarize
artifacts go to a release. Always create as **draft** first:

```sh
gh release create v0.1.0 \
  packages/app/release/Gistlist-0.1.0-arm64.dmg \
  packages/app/release/latest-mac.yml \
  --draft \
  --title "Gistlist 0.1.0 — first beta" \
  --notes "First beta. Read docs/data-directory.md for what lives where."
```

Inspect the draft on github.com/<owner>/<repo>/releases. Confirm:
- The DMG is attached.
- `latest-mac.yml` is attached (electron-updater's manifest — needed
  for the update flow to find it).
- Release notes are accurate.

When ready, click "Publish release" in the GitHub UI. **At that
moment**, electron-updater on every installed Gistlist will (next
time the app does its 4h auto-check) see the new version available.

---

## 6. After the first release

- Confirm a `0.1.0` install can find and download `0.1.1` once you cut
  it. The dev simulator (`api.updater.simulate("available-and-prompt")`)
  exercises the UI; the round-trip against a real Release exercises
  the network path.
- Update this checklist with whatever you learned. Future-you will thank
  past-you.
