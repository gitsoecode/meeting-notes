import type { Locator, Page } from "@playwright/test";

export class SettingsPage {
  readonly page: Page;
  readonly main: Locator;

  constructor(page: Page) {
    this.page = page;
    this.main = page.locator("main");
  }

  headingText() {
    return this.page.getByText("Every value here takes effect immediately.");
  }

  // General card
  obsidianSwitch() {
    return this.page.getByRole("switch", { name: "Use Obsidian as viewer" });
  }

  vaultPathInput() {
    return this.page.locator("#settings-vault-path");
  }

  dataPathInput() {
    return this.page.locator("#settings-data-path");
  }

  changeDataDirButton() {
    return this.page.getByRole("button", { name: "Change…" });
  }

  openDataDirButton() {
    return this.page.getByRole("button", { name: "Open in Finder" });
  }

  // Audio card
  micDeviceSelect() {
    return this.page.locator("#settings-mic-device");
  }

  systemDeviceSelect() {
    return this.page.locator("#settings-system-device");
  }

  // Transcription card
  asrProviderSelect() {
    return this.page.locator("#settings-asr-provider");
  }

  parakeetInstallButton() {
    return this.page.getByRole("button", {
      name: "Install / reinstall Parakeet",
    });
  }

  openaiWarning() {
    return this.page.getByText("OpenAI caps uploads at 25 MB");
  }

  // LLM card
  claudeKeyInput() {
    return this.page.locator('input[type="password"]').first();
  }

  claudeKeySaveButton() {
    // The save button next to the Claude key
    return this.page
      .locator('[class*="KeyRound"]')
      .first()
      .locator("..")
      .locator("..")
      .getByRole("button", { name: "Save" });
  }

  // Local models card
  installedModelsList() {
    return this.page.getByText("Installed Ollama models");
  }

  modelRemoveButton(modelName: string) {
    return this.page
      .getByText(modelName)
      .locator("..")
      .locator("..")
      .getByRole("button", { name: "Remove" });
  }

  pullModelInput() {
    return this.page.locator("#settings-pull-model");
  }

  pullButton() {
    return this.page.getByRole("button", { name: "Pull" });
  }

  // Shortcuts card
  shortcutRecorder() {
    return this.page.getByText("Toggle recording").locator("..").locator("..");
  }

  // Dependencies card
  dependenciesCard() {
    return this.page.getByText("Dependencies");
  }

  depRefreshButton() {
    return this.page.getByRole("button", { name: "Refresh" }).last();
  }

  depRow(name: string) {
    return this.page.getByText(name, { exact: false });
  }

  // Native selects on this page (for UX audit — visual consistency check)
  async countNativeSelects() {
    return this.page.locator("main select").count();
  }
}
