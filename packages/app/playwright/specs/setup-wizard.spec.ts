import { test, expect } from "../fixtures/setup-wizard.fixture";
import { test as appTest, expect as appExpect } from "../fixtures/base.fixture";

test.describe("Setup Wizard", () => {
  test("full forward path without Obsidian", async ({ wizard, page }) => {
    await expect(wizard.welcomeHeading()).toBeVisible();
    await expect(wizard.progressDots()).toHaveCount(5);
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
    await wizard.nextButton().click(); // deps

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
    await wizard.nextButton().click(); // deps

    await expect(wizard.depRowByName("ffmpeg")).toBeVisible();
    await expect(page.getByText(/\(system\)/)).toBeVisible();
  });

  test("step 4 never auto-fires permission prompts; both require explicit click", async ({
    wizard,
    page,
  }) => {
    // Regression guard for issue #3. Landing on step 4 must NOT fire the
    // microphone request or the system-audio probe — both UX paths trigger
    // a macOS TCC dialog (the system-audio probe indirectly via AudioTee),
    // and a user landing on the step expects to see what's about to happen
    // before any dialog opens. Only passive status reads are allowed on
    // mount; dialogs/probes only run when the user clicks.
    await page.evaluate(() => {
      const harness = (window as any).__MEETING_NOTES_TEST;
      harness.setMicPermissionStatus("not-determined");
      harness.resetPermissionCallCounts();
    });

    // Walk to step 4 (deps).
    await wizard.getStartedButton().click();
    await wizard.nextButton().click(); // step 1 → 2
    await wizard.nextButton().click(); // step 2 → 3
    await wizard.llmProviderSelect().click();
    await page.getByRole("option", { name: /Anthropic Claude/ }).click();
    await wizard.apiKeyInput().fill("sk-ant-test-key");
    await wizard.nextButton().click(); // step 3 → 4
    await expect(wizard.depsHeading()).toBeVisible();

    // Give the mount effect time to settle (it should call
    // getMicrophonePermission but nothing else).
    await page.waitForTimeout(150);

    const afterMount = await page.evaluate(() =>
      (window as any).__MEETING_NOTES_TEST.getPermissionCallCounts()
    );
    expect(afterMount.getMicrophonePermission).toBeGreaterThan(0);
    expect(afterMount.requestMicrophonePermission).toBe(0);
    expect(afterMount.probeSystemAudioPermission).toBe(0);

    // Mic button is visible because status is "not-determined".
    const grantMicButton = page.getByRole("button", {
      name: "Grant microphone access",
    });
    await expect(grantMicButton).toBeVisible();
    await grantMicButton.click();

    // System-audio: with status "unknown" the CTA is the primary
    // "Test system audio" button.
    const testSystemAudioButton = page.getByRole("button", {
      name: "Test system audio",
    });
    await expect(testSystemAudioButton).toBeVisible();
    await testSystemAudioButton.click();

    // Wait for both async handlers to settle, then assert click counts.
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
    await page.evaluate(() => {
      (window as any).__MEETING_NOTES_TEST.setDependencyState({
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

    // System audio should show as optional, not a blocking failure.
    // Match the badge exactly — the new step-4 intro copy contains the
    // word "optional" too, so a partial-text locator is now ambiguous.
    await expect(page.getByText("Optional", { exact: true })).toBeVisible();
    await expect(page.getByText(/mic-only recording still works/)).toBeVisible();
    // Finish should still be enabled (system audio is not a blocker)
    await expect(wizard.finishButton()).toBeEnabled();
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
    // Step 4 (deps) — mock has all deps OK, finish is enabled.
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
