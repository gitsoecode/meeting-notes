import { test, expect } from "../fixtures/setup-wizard.fixture";
import { test as appTest, expect as appExpect } from "../fixtures/base.fixture";

test.describe("Setup Wizard", () => {
  test("full forward path without Obsidian", async ({ wizard, page }) => {
    await expect(wizard.welcomeHeading()).toBeVisible();
    // Phase 4 added a dedicated Permissions step between Providers and
    // Dependencies — total step count is 6 now.
    await expect(wizard.progressDots()).toHaveCount(6);
    await page.screenshot({
      path: "test-results/screenshots/wizard-step0-welcome.png",
      fullPage: true,
    });

    await wizard.getStartedButton().click();
    await expect(wizard.obsidianHeading()).toBeVisible();
    await page.screenshot({
      path: "test-results/screenshots/wizard-step1-obsidian.png",
      fullPage: true,
    });

    // Skip Obsidian (default is off)
    await wizard.nextButton().click();
    await expect(wizard.dataDirHeading()).toBeVisible();
    // Data dir should auto-fill to ~/Documents/Gistlist
    await expect(wizard.dataPathInput()).toHaveValue(
      "~/Documents/Gistlist"
    );
    await page.screenshot({
      path: "test-results/screenshots/wizard-step2-datadir.png",
      fullPage: true,
    });

    await wizard.nextButton().click();
    await expect(wizard.transcriptionHeading()).toBeVisible();
    // Default is Local Ollama; switch to Anthropic Claude for the key flow.
    await wizard.llmProviderSelect().click();
    await page.getByRole("option", { name: /Anthropic Claude/ }).click();
    await wizard.apiKeyInput().fill("sk-ant-test-key");
    await page.screenshot({
      path: "test-results/screenshots/wizard-step3-transcription.png",
      fullPage: true,
    });

    await wizard.nextButton().click();
    await expect(wizard.permissionsHeading()).toBeVisible();
    // Mock starts with mic permission "not-determined" — grant it so Next
    // becomes enabled, then advance to the Dependencies step.
    await wizard.advanceFromPermissionsToDeps();
    await expect(wizard.depsHeading()).toBeVisible();
    await page.screenshot({
      path: "test-results/screenshots/wizard-step4-deps.png",
      fullPage: true,
    });

    // Mock returns all deps as installed, so Finish should be enabled
    await expect(wizard.finishButton()).toBeEnabled();
    await wizard.finishButton().click();

    // After finish, the app should load the main view
    await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "New meeting" })).toBeVisible();
  });

  test("forward path with Obsidian toggle", async ({ wizard }) => {
    await wizard.getStartedButton().click();
    await expect(wizard.obsidianHeading()).toBeVisible();

    await wizard.obsidianToggle().click();
    // Next should be disabled without vault path
    await expect(wizard.nextButton()).toBeDisabled();

    // Fill vault path
    await wizard.vaultPathInput().fill("/Users/test/Obsidian/MyVault");
    await expect(wizard.nextButton()).toBeEnabled();
    await wizard.nextButton().click();

    // Data dir should auto-default to vault + /Gistlist
    await expect(wizard.dataPathInput()).toHaveValue(
      "/Users/test/Obsidian/MyVault/Gistlist"
    );
  });

  test("pick buttons populate vault and data paths", async ({ wizard }) => {
    await wizard.getStartedButton().click();
    await wizard.obsidianToggle().click();
    await wizard.pickVaultButton().click();
    await expect(wizard.vaultPathInput()).toHaveValue("/Users/test/Documents");

    await wizard.nextButton().click();
    await wizard.pickDataDirButton().click();
    await expect(wizard.dataPathInput()).toHaveValue("/Users/test/Documents");
  });

  test("back navigation works at each step", async ({ wizard }) => {
    await wizard.getStartedButton().click();
    await expect(wizard.obsidianHeading()).toBeVisible();

    await wizard.nextButton().click();
    await expect(wizard.dataDirHeading()).toBeVisible();

    await wizard.backButton().click();
    await expect(wizard.obsidianHeading()).toBeVisible();

    await wizard.backButton().click();
    await expect(wizard.welcomeHeading()).toBeVisible();
  });

  test("Next disabled when data path is empty", async ({ wizard }) => {
    await wizard.getStartedButton().click();
    await wizard.nextButton().click();
    await expect(wizard.dataDirHeading()).toBeVisible();

    await wizard.dataPathInput().clear();
    await expect(wizard.nextButton()).toBeDisabled();

    await wizard.dataPathInput().fill("/some/path");
    await expect(wizard.nextButton()).toBeEnabled();
  });

  test("Local Ollama is the default and switching to Claude requires an API key", async ({
    wizard,
    page,
  }) => {
    await wizard.getStartedButton().click();
    await wizard.nextButton().click(); // to data dir
    await wizard.nextButton().click(); // to transcription

    // Default is Local Ollama — Next should be enabled without a key once
    // the local model picker has populated.
    await expect(wizard.nextButton()).toBeEnabled({ timeout: 3000 });

    // Regression guard: the auto-select must wait for both the host's
    // RAM probe and Ollama's installed-models probe before locking in a
    // default. The mock has qwen3.5:9b installed, so "installed wins"
    // should pick it. If either probe is skipped on initial mount, the
    // wizard freezes in recommendLocalModel(undefined) = qwen3.5:2b.
    await expect(wizard.localModelSelect()).toContainText("qwen3.5:9b");

    // Switch summarization to Anthropic Claude — Next must now be disabled
    // until an API key is supplied.
    await wizard.llmProviderSelect().click();
    await page.getByRole("option", { name: /Anthropic Claude/ }).click();
    await expect(wizard.nextButton()).toBeDisabled();

    await wizard.apiKeyInput().fill("sk-ant-test-key");
    await expect(wizard.nextButton()).toBeEnabled();

    await page.screenshot({
      path: "test-results/screenshots/wizard-step3-local-llm.png",
      fullPage: true,
    });
  });

  test("provider choices and dependency actions are functional under degraded state", async ({
    wizard,
    page,
  }) => {
    await page.evaluate(() => {
      (window as any).__MEETING_NOTES_TEST.setDependencyState({
        ffmpeg: null,
      });
    });

    await wizard.getStartedButton().click();
    await wizard.nextButton().click();
    await wizard.nextButton().click();

    await wizard.asrProviderSelect().click();
    await page.getByRole("option", { name: /OpenAI \(cloud\)/ }).click();
    await expect(wizard.nextButton()).toBeDisabled();

    await wizard.localLlmToggle().click();
    await page.getByRole("option", { name: /OpenAI ChatGPT/ }).click();
    await expect(wizard.nextButton()).toBeDisabled();

    await wizard.apiKeyInput().fill("sk-openai-test-key");
    await expect(wizard.nextButton()).toBeEnabled();
    await wizard.nextButton().click();
    await expect(wizard.permissionsHeading()).toBeVisible();
    await wizard.advanceFromPermissionsToDeps();

    await expect(wizard.depRowByName("ffmpeg")).toBeVisible();
    // Phase 2 replaced the brew flow with direct download — the install
    // button label changed from "Install via Homebrew" to "Install ffmpeg".
    await expect(wizard.installButton("Install ffmpeg")).toBeVisible();
    await expect(page.getByRole("button", { name: "Restart audio" })).toHaveCount(0);
    await wizard.installButton("Install ffmpeg").click();
    await expect(wizard.finishButton()).toBeEnabled();
  });

  test("dependencies step never mentions Homebrew or Terminal", async ({
    wizard,
    page,
  }) => {
    // Phase 3 dropped the entire "Homebrew is not installed" card. The
    // wizard must never push the user toward Terminal — pre-beta
    // requirement. This spec replaces the old "Homebrew missing shows
    // install instructions" test, which is now an anti-requirement.
    await page.evaluate(() => {
      (window as any).__MEETING_NOTES_TEST.setDependencyState({
        ffmpeg: null,
      });
    });

    await wizard.getStartedButton().click();
    await wizard.nextButton().click(); // data dir
    await wizard.nextButton().click(); // transcription
    await wizard.llmProviderSelect().click();
    await page.getByRole("option", { name: /Anthropic Claude/ }).click();
    await wizard.apiKeyInput().fill("sk-ant-test-key");
    await wizard.nextButton().click(); // permissions
    await wizard.advanceFromPermissionsToDeps();

    // No Homebrew copy anywhere on the page.
    await expect(page.getByText(/Homebrew/i)).toHaveCount(0);
    // No "open Terminal", "in Terminal", "Terminal and run" — anything
    // that asks the user to open the Terminal app. Affirmative copy
    // ("no Terminal needed") is fine because it's *reassurance*, not
    // a Terminal instruction.
    await expect(
      page.getByText(/open Terminal|in Terminal|Terminal and run/i)
    ).toHaveCount(0);
    // The fresh "Install ffmpeg" button is the user-facing path.
    await expect(wizard.installButton("Install ffmpeg")).toBeVisible();
  });

  test("ffmpeg dep row surfaces the resolver source label when present", async ({
    wizard,
    page,
  }) => {
    // The mock returns `source: "system"` for any path-set ffmpeg.
    // The renderer renders "<path> (system)" — so when ffmpeg is
    // present (default fixture state), the row should include a
    // visible source hint.
    await wizard.getStartedButton().click();
    await wizard.nextButton().click(); // data dir
    await wizard.nextButton().click(); // transcription
    await wizard.llmProviderSelect().click();
    await page.getByRole("option", { name: /Anthropic Claude/ }).click();
    await wizard.apiKeyInput().fill("sk-ant-test-key");
    await wizard.nextButton().click(); // permissions
    await wizard.advanceFromPermissionsToDeps();

    await expect(wizard.depRowByName("ffmpeg")).toBeVisible();
    await expect(page.getByText(/\(system\)/)).toBeVisible();
  });

  test("Permissions step never auto-fires prompts; both require explicit click", async ({
    wizard,
    page,
  }) => {
    // Regression guard for issue #3, adapted for the Phase-4 layout where
    // mic + system-audio live on a dedicated Permissions step (between
    // Providers and Dependencies). Landing on the step must NOT fire the
    // microphone request or the system-audio probe — both UX paths trigger
    // a macOS TCC dialog, and a user landing on the step expects to see
    // what's about to happen before any dialog opens. Only passive status
    // reads are allowed on mount; dialogs/probes only run when the user
    // clicks. The probe also runs through the new two-stage Test → Verify
    // FSM so the first probe's denied/failed result is discarded.
    await page.evaluate(() => {
      const harness = (window as any).__MEETING_NOTES_TEST;
      harness.setMicPermissionStatus("not-determined");
      harness.resetPermissionCallCounts();
    });

    await wizard.getStartedButton().click();
    await wizard.nextButton().click(); // step 1 → 2
    await wizard.nextButton().click(); // step 2 → 3
    await wizard.llmProviderSelect().click();
    await page.getByRole("option", { name: /Anthropic Claude/ }).click();
    await wizard.apiKeyInput().fill("sk-ant-test-key");
    await wizard.nextButton().click(); // step 3 → Permissions
    await expect(wizard.permissionsHeading()).toBeVisible();

    // Give the mount effect time to settle (it should call
    // getMicrophonePermission but nothing else).
    await page.waitForTimeout(150);

    const afterMount = await page.evaluate(() =>
      (window as any).__MEETING_NOTES_TEST.getPermissionCallCounts()
    );
    expect(afterMount.getMicrophonePermission).toBeGreaterThan(0);
    expect(afterMount.requestMicrophonePermission).toBe(0);
    expect(afterMount.probeSystemAudioPermission).toBe(0);

    // Next is disabled until mic is granted (Phase 4 mic gating).
    await expect(wizard.nextButton()).toBeDisabled();

    // Mic button is visible because status is "not-determined".
    await expect(wizard.grantMicButton()).toBeVisible();
    await wizard.grantMicButton().click();

    // System-audio: with status "unknown" the CTA is "Test system audio".
    // Mock auto-grants on the first probe, so the FSM transitions
    // prompting → granted directly (returning-user path).
    await expect(wizard.testSystemAudioButton()).toBeVisible();
    await wizard.testSystemAudioButton().click();

    await expect.poll(async () => {
      return await page.evaluate(() => {
        const counts = (window as any).__MEETING_NOTES_TEST.getPermissionCallCounts();
        return counts.requestMicrophonePermission + counts.probeSystemAudioPermission;
      });
    }, { timeout: 3000 }).toBeGreaterThanOrEqual(2);

    const afterClicks = await page.evaluate(() =>
      (window as any).__MEETING_NOTES_TEST.getPermissionCallCounts()
    );
    expect(afterClicks.requestMicrophonePermission).toBe(1);
    expect(afterClicks.probeSystemAudioPermission).toBe(1);

    // After granting, Next becomes enabled.
    await expect(wizard.nextButton()).toBeEnabled();
  });

  test("ollama install reports daemon-startup failure to the user", async ({
    wizard,
    page,
  }) => {
    // Regression guard for issue #3, second branch. When `deps.install`
    // succeeds but the post-install `llm.check` fails (daemon couldn't
    // bind, took too long to come up, etc.), the wizard must NOT silently
    // swallow the error — it has to surface "Ollama installed but the
    // daemon failed to start" so the user understands why the LLM row is
    // still red.
    // Simulate "Ollama not installed" so the wizard renders the Install
    // Ollama button. The real llm:check IPC handler swallows
    // ensureOllamaDaemon failures and returns
    // { daemon: false, installedModels: [] }, so we mirror that resolved-
    // but-unhealthy shape rather than rejecting.
    await page.evaluate(() => {
      (window as any).__MEETING_NOTES_TEST.setDependencyState({
        ollama: null,
      });
    });

    await wizard.getStartedButton().click();
    await wizard.nextButton().click();
    await wizard.nextButton().click();
    await wizard.nextButton().click();
    await expect(wizard.permissionsHeading()).toBeVisible();
    await wizard.advanceFromPermissionsToDeps();
    await expect(wizard.depsHeading()).toBeVisible();

    // Step 3's mount effect already called api.llm.check() to populate
    // the installed-models list, so it's safe to overwrite api.llm.check
    // here without that call consuming our override. Make the override
    // sticky so the post-install check (and any subsequent depsCheck-
    // driven re-renders) all see the same daemon-down result.
    await page.evaluate(() => {
      const api = (window as any).api;
      api.llm.check = async () => ({
        daemon: false,
        installedModels: [],
        verified: "missing" as const,
      });
    });

    await wizard.installButton("Install Ollama").click();

    await expect(
      page.getByText(/Ollama installed but the daemon failed to start/)
    ).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/~\/.gistlist\/ollama\.log/)).toBeVisible();
  });

  test("system audio shows optional badge when unsupported", async ({
    wizard,
    page,
  }) => {
    // The system-audio capability ("supported on this macOS version?")
    // now flows through the system:capabilities IPC. Override the mock's
    // capabilities() to simulate an older macOS without ScreenCaptureKit
    // system-audio support — the Permissions step should show the
    // optional/unsupported badge.
    await page.evaluate(() => {
      (window as any).api.system.capabilities = async () => ({
        systemAudioSupported: false,
      });
    });

    await wizard.getStartedButton().click();
    await wizard.nextButton().click();
    await wizard.nextButton().click();
    await wizard.llmProviderSelect().click();
    await page.getByRole("option", { name: /Anthropic Claude/ }).click();
    await wizard.apiKeyInput().fill("sk-ant-test-key");
    await wizard.nextButton().click();
    await expect(wizard.permissionsHeading()).toBeVisible();

    // System audio should show as optional, not a blocking failure.
    // The Permissions step intro copy doesn't repeat the word "optional",
    // so an exact-match locator unambiguously hits the badge.
    await expect(page.getByText("Optional", { exact: true })).toBeVisible();
    await expect(page.getByText(/mic-only recording still works/)).toBeVisible();
    // Mock's default micPermissionStatus is "granted" — the
    // unsupported-system-audio badge alone shouldn't block, so Next is
    // already enabled here.
    await expect(wizard.nextButton()).toBeEnabled();
  });

  test("ffmpeg dep row renders system-unverified amber badge (not green Ready) and exposes 'Install clean copy'", async ({
    wizard,
    page,
  }) => {
    // Reviewer P1.1: a system-PATH ffmpeg/ffprobe must NOT render as plain
    // green Ready, because we can't safely spawn it for status (Phase 2)
    // and we don't know its arch. The deps:check handler downgrades to
    // `verified: "system-unverified"` and the row must render amber with
    // an "Install clean copy" CTA. The previous patch shipped a bug
    // where DependencyStateBadge returned green Ready before checking
    // warning, so this test asserts the badge text directly.
    await wizard.getStartedButton().click();
    await wizard.nextButton().click();
    await wizard.nextButton().click();
    await wizard.llmProviderSelect().click();
    await page.getByRole("option", { name: /Anthropic Claude/ }).click();
    await wizard.apiKeyInput().fill("sk-ant-test-key");
    await wizard.nextButton().click(); // permissions
    await wizard.advanceFromPermissionsToDeps();

    // Amber badge wins over green even though path is set. Scope the
    // assertion to the ffmpeg row (other rows like Parakeet legitimately
    // render Ready when the mock has them verified).
    const ffmpegRow = page
      .getByText("ffmpeg", { exact: true })
      .locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]");
    await expect(ffmpegRow.getByText("Found (unverified)")).toBeVisible();
    await expect(ffmpegRow.getByText("Ready", { exact: true })).toHaveCount(0);

    await expect(
      page.getByRole("button", { name: /install clean ffmpeg \+ ffprobe/i })
    ).toBeVisible();
    await expect(
      page.getByText(/found a system-installed copy/i)
    ).toBeVisible();
    // System-PATH ffmpeg is allowed to Finish (per the verified-state
    // policy: only app-managed system-unverified blocks). System-Homebrew
    // is the canonical case and would dead-end most existing users
    // otherwise. Mock has all other deps OK, so Finish should be enabled.
    await expect(wizard.finishButton()).toBeEnabled();
  });

  test("Cloud ASR is NOT dead-ended by a bad app-managed Python (Python only gates Parakeet)", async ({
    wizard,
    page,
  }) => {
    // Reviewer P1.2: an OpenAI-Whisper user who happens to have a stale
    // wrong-arch <binDir>/python from a prior Parakeet attempt should
    // still be able to Finish. Python only matters when ASR is Parakeet;
    // gating it for cloud ASR would silently dead-end users with no
    // visible row to repair (Python doesn't have its own row, only
    // Parakeet does).
    await page.evaluate(() => {
      const api = (window as any).api;
      const original = api.depsCheck;
      api.depsCheck = async () => {
        const real = await original();
        return {
          ...real,
          python: {
            ...real.python,
            source: "app-installed",
            verified: "system-unverified",
          },
        };
      };
    });

    await wizard.getStartedButton().click();
    await wizard.nextButton().click();
    await wizard.nextButton().click();
    // OpenAI cloud ASR + Ollama LLM = one key (OpenAI), default LLM.
    // Mock has Ollama daemon up + qwen3.5:9b installed by default, so
    // local LLM picker auto-fills.
    await wizard.asrProviderSelect().click();
    await page.getByRole("option", { name: /OpenAI \(cloud\)/ }).click();
    await wizard.apiKeyInput().fill("sk-openai-test-key");
    await wizard.nextButton().click();
    await wizard.advanceFromPermissionsToDeps();

    // Finish must be enabled — bad Python doesn't matter for cloud ASR.
    await expect(wizard.finishButton()).toBeEnabled();
  });

  test("Finish is disabled when an app-managed dep fails arch validation (system-unverified blocks)", async ({
    wizard,
    page,
  }) => {
    // Reviewer P1.2: an app-managed binary that failed arch/spawn
    // validation gets `source: "app-installed"` AND
    // `verified: "system-unverified"`. The wizard must NOT enable
    // Finish in that state — recording would EBADARCH on first use
    // because the engine's resolved path is the broken binary.
    // System-PATH `system-unverified` is fine (Homebrew etc.); only
    // the app-managed-but-invalid case blocks.
    await page.evaluate(() => {
      // Override depsCheck to simulate a stale wrong-arch app-managed
      // ffmpeg that resolved to the app-managed path but failed arch
      // validation in the production handler.
      const api = (window as any).api;
      const originalDepsCheck = api.depsCheck;
      api.depsCheck = async () => {
        const real = await originalDepsCheck();
        return {
          ...real,
          ffmpeg: {
            ...real.ffmpeg,
            source: "app-installed",
            verified: "system-unverified",
          },
          ffprobe: {
            ...real.ffprobe,
            source: "app-installed",
            verified: "system-unverified",
          },
        };
      };
    });

    await wizard.getStartedButton().click();
    await wizard.nextButton().click();
    await wizard.nextButton().click();
    await wizard.llmProviderSelect().click();
    await page.getByRole("option", { name: /Anthropic Claude/ }).click();
    await wizard.apiKeyInput().fill("sk-ant-test-key");
    await wizard.nextButton().click();
    await wizard.advanceFromPermissionsToDeps();

    await expect(page.getByText("Found (unverified)").first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: /install clean ffmpeg \+ ffprobe/i })
    ).toBeVisible();
    // Finish is disabled — the user must Install clean copy first.
    await expect(wizard.finishButton()).toBeDisabled();
  });

  test("Embedding model has its own row and gates Finish (no surprise install)", async ({
    wizard,
    page,
  }) => {
    // v0.1.9 regression: previously the embedding model (~274 MB
    // nomic-embed-text via Ollama) was pulled silently as a side effect
    // of clicking Finish setup. That surprised users — they hadn't
    // explicitly approved the download. The fix makes it a dedicated
    // row on the Dependencies step with an "Download embedding model"
    // button, and Finish is disabled until it's installed (when the
    // user opted into semantic search).
    await page.evaluate(() => {
      (window as any).__MEETING_NOTES_TEST.setEmbedModelInstalled(false);
    });

    await wizard.getStartedButton().click();
    await wizard.nextButton().click();
    await wizard.nextButton().click();
    // Default ASR is parakeet-mlx; default LLM is Ollama with semantic
    // search enabled. Don't touch the toggle — the default is on.
    await wizard.nextButton().click(); // permissions
    await wizard.advanceFromPermissionsToDeps();

    // The embedding-model row should be visible with the explicit
    // "Download embedding model" CTA. Finish must be disabled.
    await expect(
      page.getByText("Embedding model (nomic-embed-text)")
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /download embedding model/i })
    ).toBeVisible();
    await expect(wizard.finishButton()).toBeDisabled();

    // Click the install button. Mock flips embedModelInstalled = true,
    // the renderer re-fetches status, and Finish unblocks.
    await page
      .getByRole("button", { name: /download embedding model/i })
      .click();
    await expect(wizard.finishButton()).toBeEnabled({ timeout: 5000 });
  });

  test("Parakeet install rail advances through all 4 phases including speech-model", async ({
    wizard,
    page,
  }) => {
    // Reviewer P2.2: the mock setup-asr log stream now mirrors the real
    // production stream — specifically, the synthesized `→ Downloading
    // Parakeet weights` boundary that ipc.ts emits when the engine kicks
    // off the smoke test, and the engine's `✓ Smoke test transcription:`
    // success marker. This spec proves the rail actually reaches the
    // final speech-model phase under mock e2e — without that assertion,
    // the previous mock log lines never advanced past venv and the rail
    // mis-mapping shipped silently.
    await page.evaluate(() => {
      (window as any).__MEETING_NOTES_TEST.setDependencyState({
        parakeet: null,
      });
    });

    await wizard.getStartedButton().click();
    await wizard.nextButton().click();
    await wizard.nextButton().click();
    // Default ASR is parakeet-mlx; default LLM is Ollama. No keys needed.
    await wizard.nextButton().click(); // permissions
    await wizard.advanceFromPermissionsToDeps();

    await wizard.installButton("Install Parakeet").click();

    // Wait for the panel + the speech-model boundary in the activity
    // stream. The mock emits `→ Downloading Parakeet weights` after
    // venv setup; the rail walks the log buffer to compute the active
    // phase, and the speech-model rail item should show data-rail-status="active".
    const panel = page.getByTestId("dep-install-progress");
    await expect(panel).toBeVisible();
    await expect(
      panel.locator('[data-rail-phase="speech-model"][data-rail-status="active"], [data-rail-phase="speech-model"][data-rail-status="done"]')
    ).toBeVisible({ timeout: 5000 });

    // Activity stream surfaces the smoke-test success marker — the
    // signal that verification ran (since there's no separate Verify
    // rail step now).
    await expect(
      panel.getByText(/✓ Smoke test transcription/i)
    ).toBeVisible({ timeout: 5000 });
  });

  test("DependencyInstallProgress mounts during install, persists on failure with Dismiss/Retry", async ({
    wizard,
    page,
  }) => {
    // Phase 5: the new DependencyInstallProgress panel mounts above the
    // DependencyRow list whenever installing/installError/installLog has
    // any state. After a failed install, it should stay mounted with the
    // raw-log toggle accessible and a Retry button. Dismiss clears the
    // state and unmounts the panel.
    await page.evaluate(() => {
      const harness = (window as any).__MEETING_NOTES_TEST;
      harness.setDependencyState({ ffmpeg: null });
      harness.setNextInstallFailure("ffmpeg", {
        ok: false,
        error: "synthetic test failure: download timed out",
        failedPhase: "download",
      });
    });

    await wizard.getStartedButton().click();
    await wizard.nextButton().click();
    await wizard.nextButton().click();
    await wizard.llmProviderSelect().click();
    await page.getByRole("option", { name: /Anthropic Claude/ }).click();
    await wizard.apiKeyInput().fill("sk-ant-test-key");
    await wizard.nextButton().click(); // permissions
    await wizard.advanceFromPermissionsToDeps();

    // Trigger the install — it'll fail per the priming above.
    await wizard.installButton("Install ffmpeg").click();

    // Panel should mount and show "Install failed" + the synthetic
    // error message with a Retry button.
    const panel = page.getByTestId("dep-install-progress");
    await expect(panel).toBeVisible();
    await expect(
      panel.getByRole("heading", { name: /install failed/i })
    ).toBeVisible();
    await expect(
      panel.getByText(/synthetic test failure: download timed out/i).first()
    ).toBeVisible();
    await expect(panel.getByRole("button", { name: /retry/i })).toBeVisible();

    // The raw-log toggle reveals the streamed install lines.
    await page.getByTestId("toggle-raw-log").click();
    const rawLog = page.getByTestId("raw-log");
    await expect(rawLog).toBeVisible();
    await expect(rawLog).toContainText(/ffmpeg install failed/i);

    // Dismiss clears the state and unmounts the panel.
    await panel.getByRole("button", { name: /dismiss/i }).click();
    await expect(panel).toHaveCount(0);
    // The dependency row list is still visible underneath.
    await expect(wizard.installButton("Install ffmpeg")).toBeVisible();
  });

  test("progress dots advance correctly", async ({ wizard }) => {
    await expect(wizard.activeDot()).toHaveCount(1);
    await expect(wizard.doneDots()).toHaveCount(0);

    await wizard.getStartedButton().click();
    await expect(wizard.doneDots()).toHaveCount(1);
    await expect(wizard.activeDot()).toHaveCount(1);

    await wizard.nextButton().click();
    await expect(wizard.doneDots()).toHaveCount(2);
  });
});

// ── Reopen-from-Settings flow ─────────────────────────────────────────
//
// Uses the regular `app` fixture (config.get returns the mocked existing
// config). Mock defaults are non-trivial — data_path is
// "/Users/test/Gistlist" and llm_provider is "ollama", both of which
// differ from the wizard's first-run defaults — so we don't need to
// reseed the mock to prove prefill works.

appTest.describe("Setup Wizard — reopened from Settings", () => {
  appTest("prefills every step from existing config and shows Cancel", async ({
    app,
    settings,
    page,
  }) => {
    await app.navigateTo("Settings");
    await settings.openTab("Other");
    await page.getByTestId("settings-rerun-wizard").click();

    // Wizard mounts; cancel chip visible because onCancel was provided.
    await appExpect(page.getByText("Gistlist setup")).toBeVisible();
    await appExpect(page.getByTestId("wizard-cancel")).toBeVisible();

    await page.getByRole("button", { name: "Get started" }).click();

    // Step 1 — Obsidian (mock default: disabled). Switch should be off.
    await appExpect(page.locator("#wizard-use-obsidian")).not.toBeChecked();
    await page.getByRole("button", { name: "Next" }).click();

    // Step 2 — data dir prefilled with the mock's "/Users/test/Gistlist"
    // (NOT the wizard first-run default "~/Documents/Gistlist").
    await appExpect(
      page.getByPlaceholder("/Users/you/Documents/Gistlist")
    ).toHaveValue("/Users/test/Gistlist");
  });

  appTest("rerun preserves the configured mic_device", async ({
    app,
    settings,
    page,
  }) => {
    // Mock default config has mic_device "Built-in Mic". The wizard sends
    // an empty mic_device on finish (it doesn't expose a mic picker on
    // rerun), and the IPC must NOT auto-detect-and-overwrite when an
    // existing config already has a configured mic. Otherwise re-running
    // setup silently swaps the user's mic to whatever AVFoundation lists
    // first.
    await app.navigateTo("Settings");
    await settings.openTab("Other");
    await page.getByTestId("settings-rerun-wizard").click();
    await appExpect(page.getByText("Gistlist setup")).toBeVisible();

    // Click through every step to Finish. Mic field is never touched.
    await page.getByRole("button", { name: "Get started" }).click(); // step 0
    await page.getByRole("button", { name: "Next" }).click(); // step 1 (Obsidian)
    await page.getByRole("button", { name: "Next" }).click(); // step 2 (data dir + retention)
    await page.getByRole("button", { name: "Next" }).click(); // step 3 (providers)
    // Phase 4 added a Permissions step between providers and deps. The
    // rerun-from-Settings fixture inherits mic permission state from the
    // mocked config (default "not-determined"), so grant it and advance.
    const grantMic = page.getByRole("button", {
      name: /grant microphone access/i,
    });
    if (await grantMic.isVisible().catch(() => false)) {
      await grantMic.click();
    }
    await page.getByRole("button", { name: "Next" }).click();
    // Step DEPS — mock has all deps OK, finish is enabled.
    await page.getByRole("button", { name: /finish setup/i }).click();

    // The IPC should preserve the existing mic, not the empty string the
    // wizard sent and not "Built-in Mic" auto-detected as default.
    const lastReq = await page.evaluate(() =>
      (window as any).__MEETING_NOTES_TEST.getLastInitProjectRequest()
    );
    appExpect(lastReq).not.toBeNull();
    // The wizard's request payload itself contains the empty string
    // (wizard doesn't pre-fill mic state). The fix lives in the IPC,
    // which substitutes the existing config's mic when the request is
    // empty AND an existing config is present.
    appExpect(lastReq.recording.mic_device).toBe("");

    // Verify the saved config still has the original mic.
    const savedConfig = await page.evaluate(() => (window as any).api.config.get());
    appExpect(savedConfig.recording.mic_device).toBe("Built-in Mic");
  });

  appTest("Cancel returns to Settings without writing config", async ({
    app,
    settings,
    page,
  }) => {
    await app.navigateTo("Settings");
    await settings.openTab("Other");

    // Snapshot the call counter so the assertion is robust against any
    // bootstrap-time call that might already have happened.
    const before = await page.evaluate(
      () => (window as any).__MEETING_NOTES_TEST.getInitProjectCallCount()
    );

    await page.getByTestId("settings-rerun-wizard").click();
    await appExpect(page.getByText("Gistlist setup")).toBeVisible();
    await page.getByTestId("wizard-cancel").click();

    // Settings should be visible again.
    await appExpect(page.getByText("Changes take effect immediately.")).toBeVisible();

    // Counter unchanged — the wizard wrote nothing.
    const after = await page.evaluate(
      () => (window as any).__MEETING_NOTES_TEST.getInitProjectCallCount()
    );
    appExpect(after).toBe(before);
  });
});
