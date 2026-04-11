import { test, expect } from "../fixtures/setup-wizard.fixture";

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
    // Data dir should auto-fill to ~/Documents/Meeting Notes
    await expect(wizard.dataPathInput()).toHaveValue(
      "~/Documents/Meeting Notes"
    );
    await page.screenshot({
      path: "test-results/screenshots/wizard-step2-datadir.png",
      fullPage: true,
    });

    await wizard.nextButton().click();
    await expect(wizard.transcriptionHeading()).toBeVisible();
    // Fill API key (required in cloud mode)
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

    // Data dir should auto-default to vault + /Meeting-notes
    await expect(wizard.dataPathInput()).toHaveValue(
      "/Users/test/Obsidian/MyVault/Meeting-notes"
    );
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

  test("local LLM opt-in makes Claude key optional", async ({
    wizard,
    page,
  }) => {
    await wizard.getStartedButton().click();
    await wizard.nextButton().click(); // to data dir
    await wizard.nextButton().click(); // to transcription

    // Without local LLM and without key, Next should be disabled
    await expect(wizard.nextButton()).toBeDisabled();

    // Switch summarization to a local Ollama model
    await wizard.localLlmToggle().click();
    await page.getByRole("option", { name: /Local \(Ollama\)/ }).click();

    // Now Next should be enabled without a Claude key
    // (need to wait for model picker to populate)
    await expect(wizard.nextButton()).toBeEnabled({ timeout: 3000 });

    await page.screenshot({
      path: "test-results/screenshots/wizard-step3-local-llm.png",
      fullPage: true,
    });
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
