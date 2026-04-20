import { test, expect } from "../fixtures/base.fixture";

test.describe("Settings", () => {
  test.beforeEach(async ({ app }) => {
    await app.navigateTo("Settings");
  });

  test("page loads with heading text", async ({ settings, page }) => {
    await expect(settings.headingText()).toBeVisible();
    await page.screenshot({
      path: "test-results/screenshots/settings-full.png",
      fullPage: true,
    });
  });

  test("all settings tabs are functional", async ({ settings }) => {
    await settings.openTab("Models");
    await expect(settings.defaultModelCombobox()).toBeVisible();

    await settings.openTab("Audio");
    await expect(settings.micDeviceSelect()).toBeVisible();

    await settings.openTab("Storage");
    await expect(settings.dataPathInput()).toBeVisible();

    await settings.openTab("Other");
    await expect(settings.dependenciesCard()).toBeVisible();
  });

  test("audio tab shows mic select and system audio status", async ({
    settings,
    page,
  }) => {
    await settings.openTab("Audio");
    // Mic device is a shadcn Select component (combobox role)
    await expect(settings.micDeviceSelect()).toBeVisible();

    // Click mic select to verify it opens and shows options
    await settings.micDeviceSelect().click();
    await expect(page.getByRole("option", { name: "Built-in Mic" })).toBeVisible();
    await page.keyboard.press("Escape");

    // System audio shows capability status (no device selector)
    await expect(settings.systemAudioStatus()).toBeVisible();
    // Permission hint is visible
    await expect(page.getByText(/permission will be requested|Mic-only recording/)).toBeVisible();
  });

  test("ASR provider switch to OpenAI shows warning", async ({
    settings,
    page,
  }) => {
    await settings.openTab("Models");
    // ASR provider is on Models tab now, in the Transcription card
    await settings.asrProviderSelect().click();
    await page.getByRole("option", { name: /OpenAI/ }).click();
    await expect(settings.openaiWarning()).toBeVisible();
  });

  test("Claude API key save flow", async ({ settings, page }) => {
    await settings.openTab("Models");
    // Find the Claude key section in the API Keys card
    const keyInput = settings.claudeKeyInput();
    const saveButton = settings.claudeKeySaveButton();

    await expect(saveButton).toBeDisabled();
    await keyInput.fill("sk-ant-test-key-123");
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    // After save, input should clear
    await expect(keyInput).toHaveValue("");
  });

  test("OpenAI API key save flow", async ({ settings }) => {
    await settings.openTab("Models");
    const keyInput = settings.openaiKeyInput();
    const saveButton = settings.openaiKeySaveButton();

    await expect(saveButton).toBeDisabled();
    await keyInput.fill("sk-openai-test-key-123");
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(keyInput).toHaveValue("");
  });

  test("default model selection persists across reload", async ({ settings, page }) => {
    await settings.openTab("Models");
    await settings.defaultModelCombobox().click();
    await page.getByRole("option", { name: /Sonnet 4\.6/i }).first().click();
    await expect(settings.defaultModelCombobox()).toContainText(/Sonnet/i);
    await page.reload();
    await settings.openTab("Models");
    await expect(settings.defaultModelCombobox()).toContainText(/Sonnet/i);
  });

  test("installed local models list with Remove button", async ({
    page,
  }) => {
    await page.getByRole("tab", { name: "Models" }).click();
    await expect(page.getByText("Installed models")).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove" })).toBeVisible();
  });

  test("install model modal opens via Other option", async ({ settings, page }) => {
    await settings.openTab("Models");
    await settings.installModelSelect().click();
    await page.getByRole("option", { name: "Other…" }).click();
    await page.keyboard.press("Escape");
    await expect(settings.installModelCustomInput()).toBeVisible();
    await settings.installModelCustomInput().fill("llama3.1:8b");
    await settings.installButton().click();
    // Confirm dialog appears first
    const confirmHeading = page.getByRole("heading", { name: /Install llama3\.1:8b/ });
    await expect(confirmHeading).toBeVisible();
    // Click the confirm button inside the dialog (not the card's Install button)
    const confirmDialog = page.getByRole("dialog").filter({ has: confirmHeading });
    await confirmDialog.getByRole("button", { name: "Install" }).click();
    // The mock resolves instantly so the title may already be "Pulled …"
    await expect(page.getByRole("heading", { name: /Pull(?:ing|ed) llama3\.1:8b/ })).toBeVisible();

    // Close the modal — use the text-based Close button (not the X icon)
    const closeButton = page
      .getByRole("dialog")
      .getByRole("button", { name: /^Close/ })
      .first();
    await expect(closeButton).toBeEnabled({ timeout: 5000 });
    await closeButton.click();
  });

  test("remove local model can be cancelled and confirmed", async ({
    settings,
    page,
  }) => {
    await settings.openTab("Models");
    await settings.modelRemoveButton("qwen3.5:9b").click();
    await expect(settings.removeModelConfirmButton()).toBeVisible();
    await settings.removeModelCancelButton().click();
    await expect(page.getByRole("button", { name: "Remove" })).toBeVisible();

    await settings.modelRemoveButton("qwen3.5:9b").click();
    await settings.removeModelConfirmButton().click();
    await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
  });

  test("dependencies card shows all rows", async ({ settings, page }) => {
    await settings.openTab("Other");
    await expect(page.getByText("ffmpeg", { exact: true })).toBeVisible();
    // BlackHole removed — system audio is automatic via AudioTee
    await expect(page.getByText("Python", { exact: true })).toBeVisible();
    await expect(page.getByText("Parakeet", { exact: true })).toBeVisible();
    await expect(page.getByText("whisper.cpp", { exact: true })).toBeVisible();
    await expect(page.getByText("Ollama", { exact: true })).toBeVisible();
  });

  test("shortcut section is visible", async ({ page, settings }) => {
    await settings.openTab("Other");
    await expect(page.getByText("Toggle recording")).toBeVisible();
    // The shortcut recorder should show current binding
    await expect(page.getByRole("heading", { name: "Keyboard Shortcuts" })).toBeVisible();
  });

  test("storage actions update paths and record external directory opens", async ({
    app,
    settings,
    page,
  }) => {
    await settings.openTab("Storage");
    await settings.changeDataDirButton().click();
    await page.getByRole("button", { name: "Move files" }).click();
    await expect(settings.dataPathInput()).toHaveValue("/Users/test/Documents");

    await settings.openDataDirButton().click();
    await expect
      .poll(async () => await app.lastExternalAction())
      .toMatchObject({
        type: "open-data-directory",
        payload: { path: "/Users/test/Documents" },
      });
  });

  test("Obsidian vault picker path is functional", async ({ settings }) => {
    await settings.openTab("Storage");
    await settings.obsidianSwitch().click();
    await expect(settings.vaultPathInput()).toBeVisible();
    await settings.page.getByRole("button", { name: "Pick…" }).click();
    await expect(settings.vaultPathInput()).toHaveValue("/Users/test/Documents");
  });

  test("Parakeet setup modal can run and degraded dependency state renders", async ({
    app,
    settings,
    page,
  }) => {
    await app.setDependencyState({ ffmpeg: null });
    await page.reload();
    await settings.openTab("Other");
    await expect(settings.dependenciesCard().getByText(/not found/i).first()).toBeVisible();

    // Transcription is now on Models tab
    await settings.openTab("Models");
    // Parakeet is installed in mock, so the reinstall link should be present
    // But we need to test the install flow — set parakeet to null
    await app.setDependencyState({ parakeet: null });
    await page.reload();
    await settings.openTab("Models");
    await settings.parakeetInstallButton().click();
    // Confirm dialog appears first
    await page.getByRole("button", { name: "Install" }).click();
    await expect(page.getByRole("heading", { name: /Install Parakeet/ })).toBeVisible();
    await settings.runParakeetSetupButton().click();
    await expect(page.getByText(/Parakeet.*installed/).first()).toBeVisible();
    await settings.setupParakeetCloseButton().click();
  });

  test("settings page can scroll past shortcuts to system health", async ({ page, settings }) => {
    await settings.openTab("Other");
    const systemHealth = page.getByText("System Health", { exact: true });
    await systemHealth.scrollIntoViewIfNeeded();
    await expect(systemHealth).toBeVisible();
  });

  test("data directory shows current path", async ({ settings }) => {
    await settings.openTab("Storage");
    await expect(settings.dataPathInput()).toHaveValue(
      "/Users/test/Gistlist"
    );
  });

  test("audio retention dropdown defaults to Never and can change to 30 days", async ({
    settings,
    page,
  }) => {
    await settings.openTab("Storage");
    const select = settings.audioRetentionSelect();
    await expect(select).toBeVisible();
    await expect(select).toContainText("Never");

    await select.click();
    await page.getByRole("option", { name: "30 days" }).click();
    await expect(select).toContainText("30 days");
  });

  test("audio retention custom option shows number input", async ({
    settings,
    page,
  }) => {
    await settings.openTab("Storage");
    const select = settings.audioRetentionSelect();
    await select.click();
    await page.getByRole("option", { name: "Custom" }).click();
    await expect(settings.audioRetentionCustomInput()).toBeVisible();
  });
});
