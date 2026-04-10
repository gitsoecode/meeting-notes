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

  test("Obsidian toggle shows and hides vault path", async ({ settings }) => {
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
    // ASR provider is a shadcn Select (combobox), not a native <select>
    await settings.asrProviderSelect().click();
    await page.getByRole("option", { name: /OpenAI/ }).click();
    await expect(settings.openaiWarning()).toBeVisible();
    // OpenAI key input should appear
    await expect(page.getByText("OpenAI API key")).toBeVisible();
  });

  test("Claude API key save flow", async ({ settings, page }) => {
    // Find the Claude key section
    const claudeSection = page
      .getByText("Anthropic API key")
      .locator("..")
      .locator("..");
    const keyInput = claudeSection.locator('input[type="password"]');
    const saveButton = claudeSection.getByRole("button", { name: "Save" });

    await expect(saveButton).toBeDisabled();
    await keyInput.fill("sk-ant-test-key-123");
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    // After save, input should clear
    await expect(keyInput).toHaveValue("");
  });

  test("installed local models list with Remove button", async ({
    settings,
    page,
  }) => {
    await expect(page.getByText("qwen3.5:9b")).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove" })).toBeVisible();
  });

  test("pull model modal opens", async ({ settings, page }) => {
    await settings.pullModelInput().fill("llama3.1:8b");
    await settings.pullButton().click();
    await expect(page.getByText("Pulling llama3.1:8b")).toBeVisible();

    // Close the modal — use the text-based Close button (not the X icon)
    const closeButton = page
      .getByRole("dialog")
      .getByRole("button", { name: "Close" })
      .first();
    await expect(closeButton).toBeEnabled({ timeout: 5000 });
    await closeButton.click();
  });

  test("dependencies card shows all rows", async ({ settings, page }) => {
    await expect(page.getByText("ffmpeg", { exact: true })).toBeVisible();
    await expect(page.getByText("BlackHole (2ch)", { exact: true })).toBeVisible();
    await expect(page.getByText("Python", { exact: true })).toBeVisible();
    await expect(page.getByText("Parakeet", { exact: true })).toBeVisible();
    await expect(page.getByText("Ollama daemon", { exact: true })).toBeVisible();
  });

  test("shortcut section is visible", async ({ page }) => {
    await expect(page.getByText("Toggle recording")).toBeVisible();
    // The shortcut recorder should show current binding
    await expect(page.getByText("Shortcuts")).toBeVisible();
  });

  test("settings page can scroll past shortcuts to system status", async ({ page }) => {
    const systemStatus = page.getByRole("button", { name: "System Status" });
    await systemStatus.scrollIntoViewIfNeeded();
    await expect(systemStatus).toBeVisible();
  });

  test("data directory shows current path", async ({ settings }) => {
    await expect(settings.dataPathInput()).toHaveValue(
      "/Users/test/Meeting Notes"
    );
  });
});
