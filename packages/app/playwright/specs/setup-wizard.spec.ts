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

    // Mock returns all deps as installed, so the chain has no work and
    // Finish is enabled directly. The "Install all" button should NOT
    // appear because there's nothing pending.
    await expect(wizard.installAllButton()).toHaveCount(0);
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

  test("dependencies step never mentions Homebrew or Terminal", async ({
    wizard,
    page,
  }) => {
    // Phase 3 dropped the entire "Homebrew is not installed" card. The
    // wizard must never push the user toward Terminal — pre-beta
    // requirement.
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
    // The chain's single Install all CTA replaces the per-row buttons.
    await expect(wizard.installAllButton()).toBeVisible();
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
    // clicks.
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
    await expect(page.getByText("Optional", { exact: true })).toBeVisible();
    await expect(page.getByText(/mic-only recording still works/)).toBeVisible();
    // Mock's default micPermissionStatus is "granted" — the
    // unsupported-system-audio badge alone shouldn't block, so Next is
    // already enabled here.
    await expect(wizard.nextButton()).toBeEnabled();
  });

  test("Cloud ASR is NOT dead-ended by a bad app-managed Python", async ({
    wizard,
    page,
  }) => {
    // Reviewer P1.2 (preserved across redesign): Python only matters when
    // ASR is Parakeet. With cloud ASR the parakeet row isn't even in the
    // chain plan, so a stale wrong-arch <binDir>/python from a prior
    // attempt must NOT block Finish.
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
    // OpenAI cloud ASR + Ollama LLM. Mock has Ollama daemon up + qwen3.5:9b
    // installed, so the chain is empty (everything Ready).
    await wizard.asrProviderSelect().click();
    await page.getByRole("option", { name: /OpenAI \(cloud\)/ }).click();
    await wizard.apiKeyInput().fill("sk-openai-test-key");
    await wizard.nextButton().click();
    await wizard.advanceFromPermissionsToDeps();

    // Finish must be enabled — bad Python doesn't matter for cloud ASR.
    await expect(wizard.finishButton()).toBeEnabled();
  });

  test("Finish is disabled when an app-managed dep fails arch validation; Install all repairs it", async ({
    wizard,
    page,
  }) => {
    // App-managed-broken case: ffmpeg has a path but failed arch
    // validation. `deriveRequiredInstalls` treats `system-unverified`
    // app-managed binaries as not-ready, so the chain row appears as
    // Pending and the chain's "Install all" repairs it. Finish stays
    // disabled until the chain succeeds.
    await page.evaluate(() => {
      const api = (window as any).api;
      const originalDepsCheck = api.depsCheck;
      let firstCallReturned = false;
      api.depsCheck = async () => {
        const real = await originalDepsCheck();
        // Only the FIRST call (the wizard's initial probe) returns the
        // broken state. Once the chain calls deps.install("ffmpeg") the
        // mock flips ffmpeg/ffprobe paths to valid Homebrew paths; the
        // post-install depsCheck should reflect the repair.
        if (firstCallReturned) return real;
        firstCallReturned = true;
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

    // ffmpeg row visible as pending; Finish disabled.
    await expect(wizard.depRow("ffmpeg")).toHaveAttribute("data-state", "pending");
    await expect(wizard.finishButton()).toHaveCount(0);
    await expect(wizard.installAllButton()).toBeVisible();

    // Run the chain.
    await wizard.installAllButton().click();
    await expect(wizard.depRow("ffmpeg")).toHaveAttribute("data-state", "done", {
      timeout: 5000,
    });
    await expect(wizard.finishButton()).toBeEnabled();
  });

  test("Finish with semantic search disabled does NOT trigger an embed-model pull", async ({
    wizard,
    page,
  }) => {
    // v0.1.9 regression: the explicit row removed the surprise pull
    // from `Finish setup`, the v0.1.10 redesign keeps the principle —
    // when the user opts out of semantic search there's no embed-model
    // row, no chain step, no pull. This pins the never-pull-without-
    // explicit-click contract from the renderer side.
    await page.evaluate(() => {
      const harness = (window as any).__MEETING_NOTES_TEST;
      harness.setEmbedModelInstalled(false);
    });

    await wizard.getStartedButton().click();
    await wizard.nextButton().click();
    await wizard.nextButton().click();
    // Toggle semantic search OFF on the providers step.
    await page.locator("#wizard-enable-semantic-search").click();
    await wizard.nextButton().click();
    await wizard.advanceFromPermissionsToDeps();

    // No embed-model row should be visible.
    await expect(wizard.depRow("embed-model")).toHaveCount(0);

    await wizard.finishButton().click();
    await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();

    const calls = await page.evaluate(() =>
      (window as any).__MEETING_NOTES_TEST.getInstallEmbedModelCallCount()
    );
    expect(calls).toBe(0);
  });

  test("Semantic search + Claude LLM: Ollama + embed-model rows appear in chain", async ({
    wizard,
    page,
  }) => {
    // v0.1.9 P1 regression preserved across redesign: when the user
    // picks a cloud LLM AND keeps semantic search enabled, the chain
    // plan must include both Ollama (the embed-model lives in Ollama)
    // AND the embed-model row.
    await page.evaluate(() => {
      const harness = (window as any).__MEETING_NOTES_TEST;
      harness.setEmbedModelInstalled(false);
      // Force Ollama daemon as not running so both rows are pending.
      harness.setDependencyState({ ollama: null });
    });

    await wizard.getStartedButton().click();
    await wizard.nextButton().click();
    await wizard.nextButton().click();
    // Switch LLM to Claude — Ollama row should still appear because
    // semantic search is on by default.
    await wizard.llmProviderSelect().click();
    await page.getByRole("option", { name: /Anthropic Claude/ }).click();
    await wizard.apiKeyInput().fill("sk-ant-test-key");
    await wizard.nextButton().click();
    await wizard.advanceFromPermissionsToDeps();

    await expect(wizard.depRow("ollama")).toBeVisible();
    await expect(wizard.depRow("embed-model")).toBeVisible();
    await expect(wizard.depRow("ollama")).toHaveAttribute("data-state", "pending");
    await expect(wizard.depRow("embed-model")).toHaveAttribute("data-state", "pending");

    // Run the chain — Ollama installs, embed-model pulls, Finish unlocks.
    await wizard.installAllButton().click();
    await expect(wizard.finishButton()).toBeEnabled({ timeout: 8000 });
  });

  test("Install all chain runs ffmpeg → parakeet → ollama → embed-model → local-llm in order", async ({
    wizard,
    page,
  }) => {
    // Pin the dependency chain ordering. The chain must walk plan
    // entries in `INSTALL_ORDER` rather than firing concurrently.
    await page.evaluate(() => {
      const harness = (window as any).__MEETING_NOTES_TEST;
      harness.resetInstallCallOrder();
      harness.setEmbedModelInstalled(false);
      // Clear the local-LLM models so the chain has work to do for the
      // local-llm row too (default fixture has qwen3.5:9b installed,
      // which would mark that row alreadyReady and skip it).
      harness.setInstalledLocalModels([]);
      // All deps missing so every chain step actually runs.
      harness.setDependencyState({
        ffmpeg: null,
        ffprobe: null,
        parakeet: null,
        ollama: null,
      });
    });

    await wizard.getStartedButton().click();
    await wizard.nextButton().click(); // Obsidian
    await wizard.nextButton().click(); // data dir
    // Default ASR = Parakeet, default LLM = Ollama, semantic search on.
    await wizard.nextButton().click(); // permissions
    await wizard.advanceFromPermissionsToDeps();

    await wizard.installAllButton().click();
    await expect(wizard.finishButton()).toBeEnabled({ timeout: 10_000 });

    const order = await page.evaluate(() =>
      (window as any).__MEETING_NOTES_TEST.getInstallCallOrder()
    );
    // ffmpeg comes from `deps.install("ffmpeg")`; ollama similarly.
    // parakeet comes from `setupAsr()`; embed-model from
    // `meetingIndex.installEmbedModel()`; local-llm from `llm.setup()`.
    expect(order).toEqual([
      "ffmpeg",
      "parakeet",
      "ollama",
      "embed-model",
      "local-llm",
    ]);
  });

  test("Already-Ready deps render with Ready state and the chain skips them", async ({
    wizard,
    page,
  }) => {
    // ffmpeg + Ollama already installed; only Parakeet and embed-model
    // remain. The chain should fire ONLY parakeet + embed-model
    // installs, not re-run the already-ready ones.
    await page.evaluate(() => {
      const harness = (window as any).__MEETING_NOTES_TEST;
      harness.resetInstallCallOrder();
      harness.setEmbedModelInstalled(false);
      // ffmpeg + ffprobe + ollama present (default), parakeet missing.
      harness.setDependencyState({ parakeet: null });
    });

    await wizard.getStartedButton().click();
    await wizard.nextButton().click();
    await wizard.nextButton().click();
    // Default ASR = Parakeet, LLM = Ollama (mock has qwen3.5:9b installed).
    await wizard.nextButton().click(); // permissions
    await wizard.advanceFromPermissionsToDeps();

    // ffmpeg + ollama show Ready immediately; parakeet + embed-model pending.
    await expect(wizard.depRow("ffmpeg")).toHaveAttribute("data-state", "ready");
    await expect(wizard.depRow("ollama")).toHaveAttribute("data-state", "ready");
    await expect(wizard.depRow("parakeet")).toHaveAttribute("data-state", "pending");
    await expect(wizard.depRow("embed-model")).toHaveAttribute("data-state", "pending");

    await wizard.installAllButton().click();
    await expect(wizard.finishButton()).toBeEnabled({ timeout: 8000 });

    const order = await page.evaluate(() =>
      (window as any).__MEETING_NOTES_TEST.getInstallCallOrder()
    );
    // Only the missing rows ran. ffmpeg and ollama dispatchers were
    // never called because their `alreadyReady` flag was true.
    expect(order).toEqual(["parakeet", "embed-model"]);
  });

  test("Failure halts the chain; Retry resumes from the failed row", async ({
    wizard,
    page,
  }) => {
    // ffmpeg succeeds, then prime Ollama to fail. Chain pauses on
    // Ollama; subsequent rows stay Pending. Retry re-runs Ollama (which
    // now succeeds because the failure override is one-shot) and the
    // chain resumes through the rest.
    await page.evaluate(() => {
      const harness = (window as any).__MEETING_NOTES_TEST;
      harness.resetInstallCallOrder();
      harness.setEmbedModelInstalled(false);
      harness.setDependencyState({
        ffmpeg: null,
        ffprobe: null,
        ollama: null,
        parakeet: null,
      });
      harness.setNextInstallFailure("ollama", {
        ok: false,
        error: "synthetic ollama failure: download timed out",
        failedPhase: "download",
      });
    });

    await wizard.getStartedButton().click();
    await wizard.nextButton().click();
    await wizard.nextButton().click();
    await wizard.nextButton().click();
    await wizard.advanceFromPermissionsToDeps();

    await wizard.installAllButton().click();

    // Ollama row goes failed; the embed-model row that comes after it
    // in the chain stays pending. (local-llm shows up Ready because the
    // default mock fixture pre-installs qwen3.5:9b — that's correct
    // behavior for an "already-ready" row, just not what this test
    // is asserting.)
    await expect(wizard.depRow("ollama")).toHaveAttribute("data-state", "failed", {
      timeout: 8000,
    });
    await expect(wizard.depRowError("ollama")).toContainText(
      /synthetic ollama failure/i
    );
    await expect(wizard.depRow("embed-model")).toHaveAttribute("data-state", "pending");

    // Retry re-runs ollama (failure override is one-shot) → success → chain resumes.
    await wizard.chainRetryButton().click();
    await expect(wizard.finishButton()).toBeEnabled({ timeout: 10_000 });
  });

  test("Cancel during Parakeet aborts the install (real cancel signal)", async ({
    wizard,
    page,
  }) => {
    // Parakeet is the only dep with a real abort signal. Clicking
    // Cancel mid-install must reach `api.cancelSetupAsr()`, which the
    // mock's setupAsr poll loop watches — the install rejects with an
    // abort error, the chain reclassifies the row as `cancelled`
    // (mode="abort"), and the footer offers Resume.
    await page.evaluate(() => {
      const harness = (window as any).__MEETING_NOTES_TEST;
      harness.resetInstallCallOrder();
      harness.setEmbedModelInstalled(true);
      harness.setInstalledLocalModels(["qwen3.5:9b"]);
      // ffmpeg + ollama already ready so the chain skips straight to
      // Parakeet (the only dep we want to test the cancel for).
      harness.setDependencyState({ parakeet: null });
      // Long enough that we can observe Parakeet running and click
      // Cancel before it finishes. The mock's setupAsr polls the
      // abort flag every 25ms.
      harness.setInstallDelayMs(2000);
    });

    await wizard.getStartedButton().click();
    await wizard.nextButton().click();
    await wizard.nextButton().click();
    // Default ASR = Parakeet, default LLM = Ollama.
    await wizard.nextButton().click();
    await wizard.advanceFromPermissionsToDeps();

    await wizard.installAllButton().click();

    // Parakeet starts running.
    await expect(wizard.depRow("parakeet")).toHaveAttribute(
      "data-state",
      "running",
      { timeout: 5000 },
    );

    // Cancel — the mock setupAsr poll loop sees the abort flag and
    // rejects. The reducer marks the row `cancelled` (mode="abort"),
    // not `failed` (the reject was user-initiated, not a real error).
    await wizard.cancelChainButton().click();
    await expect(wizard.depRow("parakeet")).toHaveAttribute(
      "data-state",
      "cancelled",
      { timeout: 5000 },
    );

    // Footer offers Resume install (chain state == cancelled).
    await expect(wizard.resumeChainButton()).toBeVisible();

    // No error UI on the row — the cancel wasn't an error.
    await expect(wizard.depRowError("parakeet")).toHaveCount(0);
  });

  test("Cancel during a non-cancellable install lets it finish then stops the chain", async ({
    wizard,
    page,
  }) => {
    // Click Cancel during ffmpeg's install. ffmpeg has no real abort —
    // it finishes successfully, then the chain stops with state
    // "cancelled". Subsequent rows stay pending. The footer offers a
    // Resume install button.
    await page.evaluate(() => {
      const harness = (window as any).__MEETING_NOTES_TEST;
      harness.resetInstallCallOrder();
      harness.setEmbedModelInstalled(false);
      harness.setDependencyState({
        ffmpeg: null,
        ffprobe: null,
        ollama: null,
        parakeet: null,
      });
      // Add a perceptible delay so the test has a window to hit Cancel
      // before ffmpeg returns.
      harness.setInstallDelayMs(500);
    });

    await wizard.getStartedButton().click();
    await wizard.nextButton().click();
    await wizard.nextButton().click();
    await wizard.nextButton().click();
    await wizard.advanceFromPermissionsToDeps();

    await wizard.installAllButton().click();

    // Cancel while chain is running; the active install (ffmpeg)
    // completes, chain transitions to cancelled, Resume button appears.
    await wizard.cancelChainButton().click();
    await expect(wizard.resumeChainButton()).toBeVisible({ timeout: 5000 });

    // ffmpeg should be `done` (it finished cleanly), parakeet still pending.
    await expect(wizard.depRow("ffmpeg")).toHaveAttribute("data-state", "done");
    await expect(wizard.depRow("parakeet")).toHaveAttribute("data-state", "pending");
  });

  test("Single ffmpeg install through the chain reports failure with phase", async ({
    wizard,
    page,
  }) => {
    // Migrated from installer-failure-modes. The chain surfaces failure
    // info on the failed row instead of in a separate panel.
    await page.evaluate(() => {
      const harness = (window as any).__MEETING_NOTES_TEST;
      harness.setDependencyState({ ffmpeg: null, ffprobe: null });
      harness.setNextInstallFailure("ffmpeg", {
        ok: false,
        error: "checksum mismatch: expected abc, got xyz",
        failedPhase: "verify-checksum",
      });
    });

    await wizard.getStartedButton().click();
    await wizard.nextButton().click();
    await wizard.nextButton().click();
    await wizard.llmProviderSelect().click();
    await page.getByRole("option", { name: /Anthropic Claude/ }).click();
    await wizard.apiKeyInput().fill("sk-ant-test-key");
    await wizard.nextButton().click();
    await wizard.advanceFromPermissionsToDeps();

    await wizard.installAllButton().click();
    await expect(wizard.depRow("ffmpeg")).toHaveAttribute("data-state", "failed", {
      timeout: 5000,
    });
    await expect(wizard.depRowError("ffmpeg")).toContainText(
      /checksum mismatch/i
    );
    await expect(wizard.depRowError("ffmpeg")).toContainText(/verify-checksum/i);

    // Activity log surfaces the streamed install line.
    await expect(wizard.activityLog()).toBeVisible();
    await wizard.activityLog().click();
    await expect(wizard.activityLog()).toContainText(/ffmpeg install failed/i);

    // Retry succeeds (override is one-shot), Finish unlocks.
    await wizard.chainRetryButton().click();
    await expect(wizard.finishButton()).toBeEnabled({ timeout: 5000 });
  });

  test("ollama install reports daemon-startup failure to the user", async ({
    wizard,
    page,
  }) => {
    // Regression: when `deps.install("ollama")` succeeds but the
    // post-install `llm.check` fails (daemon couldn't bind), the
    // dispatcher must throw with "Ollama installed but the daemon failed
    // to start" so the user understands why the row is red.
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

    // Make the override sticky so the post-install llm.check sees daemon down.
    await page.evaluate(() => {
      const api = (window as any).api;
      api.llm.check = async () => ({
        daemon: false,
        installedModels: [],
        verified: "missing" as const,
      });
    });

    await wizard.installAllButton().click();

    // Ollama row fails with the daemon-startup message.
    await expect(wizard.depRow("ollama")).toHaveAttribute("data-state", "failed", {
      timeout: 8000,
    });
    await expect(wizard.depRowError("ollama")).toContainText(
      /Ollama installed but the daemon failed to start/
    );
    await expect(wizard.depRowError("ollama")).toContainText(
      /~\/.gistlist\/ollama\.log/
    );
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
