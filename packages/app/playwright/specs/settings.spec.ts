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

    await settings.openTab("Transcription");
    await expect(settings.micDeviceSelect()).toBeVisible();

    await settings.openTab("Storage");
    await expect(settings.dataPathInput()).toBeVisible();

    await settings.openTab("General");
    await expect(settings.dependenciesCard()).toBeVisible();
  });

  test("Obsidian toggle shows and hides vault path", async ({ settings }) => {
    await settings.openTab("Storage");
    // Initially disabled in mock
    await expect(settings.vaultPathInput()).not.toBeVisible();

    await settings.obsidianSwitch().click();
    await expect(settings.vaultPathInput()).toBeVisible();

    await settings.obsidianSwitch().click();
    await expect(settings.vaultPathInput()).not.toBeVisible();
  });

  test("audio device selects are shadcn comboboxes", async ({
    settings,
    page,
  }) => {
    await settings.openTab("Transcription");
    // Audio device selects are shadcn Select components (combobox role)
    await expect(settings.micDeviceSelect()).toBeVisible();
    await expect(settings.systemDeviceSelect()).toBeVisible();

    // Click mic select to verify it opens and shows options
    await settings.micDeviceSelect().click();
    await expect(page.getByRole("option", { name: "Built-in Mic" })).toBeVisible();
    // Close by pressing Escape
    await page.keyboard.press("Escape");

    // Click system select
    await settings.systemDeviceSelect().click();
    await expect(page.getByRole("option", { name: "BlackHole 2ch" })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("ASR provider switch to OpenAI shows warning", async ({
    settings,
    page,
  }) => {
    await settings.openTab("Transcription");
    // ASR provider is a shadcn Select (combobox), not a native <select>
    await settings.asrProviderSelect().click();
    await page.getByRole("option", { name: /OpenAI/ }).click();
    await expect(settings.openaiWarning()).toBeVisible();
  });

  test("Claude API key save flow", async ({ settings, page }) => {
    await settings.openTab("Models");
    // Find the Claude key section
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

  test("pull model modal opens", async ({ settings, page }) => {
    await settings.openTab("Models");
    await settings.pullModelInput().click();
    await page.getByRole("option", { name: "Custom…" }).click();
    await page.keyboard.press("Escape");
    await expect(settings.pullCustomModelInput()).toBeVisible();
    await settings.pullCustomModelInput().fill("llama3.1:8b");
    await settings.pullButton().click();
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
    await settings.openTab("General");
    await expect(page.getByText("ffmpeg", { exact: true })).toBeVisible();
    await expect(page.getByText("BlackHole (2ch)", { exact: true })).toBeVisible();
    await expect(page.getByText("Python", { exact: true })).toBeVisible();
    await expect(page.getByText("Parakeet", { exact: true })).toBeVisible();
    await expect(page.getByText("Ollama", { exact: true })).toBeVisible();
  });

  test("shortcut section is visible", async ({ page, settings }) => {
    await settings.openTab("General");
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
    await app.setDependencyState({ blackhole: "missing", ffmpeg: null });
    await page.reload();
    await settings.openTab("General");
    await expect(settings.dependenciesCard().getByText(/not found/i).first()).toBeVisible();

    await settings.openTab("Transcription");
    await settings.parakeetInstallButton().click();
    await expect(page.getByRole("heading", { name: /Install Parakeet|Check \/ repair Parakeet/ })).toBeVisible();
    await settings.runParakeetSetupButton().click();
    await expect(page.getByText(/Parakeet verified|Parakeet installed/).first()).toBeVisible();
    await settings.setupParakeetCloseButton().click();
  });

  test("settings page can scroll past shortcuts to system health", async ({ page, settings }) => {
    await settings.openTab("General");
    const systemHealth = page.getByText("System Health", { exact: true });
    await systemHealth.scrollIntoViewIfNeeded();
    await expect(systemHealth).toBeVisible();
  });

  test("data directory shows current path", async ({ settings }) => {
    await settings.openTab("Storage");
    await expect(settings.dataPathInput()).toHaveValue(
      "/Users/test/Meeting Notes"
    );
  });
});
