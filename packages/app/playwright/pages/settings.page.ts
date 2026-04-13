import type { Locator, Page } from "@playwright/test";

export class SettingsPage {
  readonly page: Page;
  readonly main: Locator;

  constructor(page: Page) {
    this.page = page;
    this.main = page.locator("main");
  }

  headingText() {
    return this.page.getByText("Changes take effect immediately.");
  }

  tab(name: string) {
    return this.page.getByRole("tab", { name });
  }

  async openTab(name: string) {
    await this.tab(name).click();
  }

  card(title: string) {
    return this.main.locator('[class*="rounded"], [class*="Card"]').filter({
      has: this.page.getByText(title, { exact: true }),
    }).first();
  }

  // General card
  obsidianSwitch() {
    const card = this.card("Obsidian Integration");
    return card.getByRole("switch");
  }

  vaultPathInput() {
    return this.card("Obsidian Integration").getByPlaceholder("(not set)");
  }

  dataPathInput() {
    return this.card("Data Storage").locator("input").first();
  }

  changeDataDirButton() {
    return this.page.getByRole("button", { name: "Move…" });
  }

  openDataDirButton() {
    return this.card("Data Storage").getByRole("button").nth(1);
  }

  // Audio card (on Audio tab)
  micDeviceSelect() {
    return this.page.locator("#settings-mic");
  }

  systemDeviceSelect() {
    return this.page.locator("#settings-sys-audio");
  }

  // Transcription card (on Models tab)
  asrProviderSelect() {
    return this.page.locator("#settings-asr");
  }

  parakeetInstallButton() {
    return this.card("Transcription").getByRole("button", {
      name: /Install Parakeet/,
    });
  }

  openaiWarning() {
    return this.page.getByText(/Uploads are capped at 25 MB/);
  }

  // API Keys card (on Models tab)
  claudeKeyInput() {
    return this.card("API Keys").getByPlaceholder(/paste key|••••• stored/).first();
  }

  claudeKeySaveButton() {
    return this.card("API Keys").getByRole("button", { name: "Save" }).first();
  }

  openaiKeyInput() {
    return this.card("API Keys").getByPlaceholder(/paste key|••••• stored/).nth(1);
  }

  openaiKeySaveButton() {
    return this.card("API Keys").getByRole("button", { name: "Save" }).nth(1);
  }

  // Text Analysis card (on Models tab)
  defaultModelCombobox() {
    return this.card("Text Analysis").getByRole("combobox").first();
  }

  // Local models card (on Models tab)
  installedModelsList() {
    return this.card("Local Models").getByText("Installed models");
  }

  modelRemoveButton(modelName: string) {
    return this.card("Local Models")
      .locator("div")
      .filter({ has: this.page.getByText(modelName, { exact: true }) })
      .getByRole("button", { name: "Remove" });
  }

  removeModelConfirmButton() {
    return this.page.getByRole("button", { name: "Remove model" });
  }

  removeModelCancelButton() {
    return this.page.getByRole("button", { name: "Keep model" });
  }

  installModelSelect() {
    return this.card("Local Models").getByRole("combobox").first();
  }

  installModelCustomInput() {
    return this.card("Local Models").getByPlaceholder(/deepseek/i);
  }

  installButton() {
    return this.card("Local Models").getByRole("button", { name: "Install" });
  }

  pullModelCloseButton() {
    return this.page.getByRole("dialog").getByRole("button", { name: "Close" });
  }

  // Shortcuts card
  shortcutRecorder() {
    return this.card("Keyboard Shortcuts").getByText("Toggle recording").locator("..").locator("..");
  }

  // Dependencies card
  dependenciesCard() {
    return this.card("System Health");
  }

  runParakeetSetupButton() {
    return this.page.getByRole("dialog").getByRole("button", { name: /Reinstall|Install/ });
  }

  setupParakeetCloseButton() {
    return this.page.getByRole("dialog").getByRole("button", { name: "Close" }).first();
  }

  depRow(name: string) {
    return this.dependenciesCard().getByText(name, { exact: false });
  }

  // Audio retention card (on Storage tab)
  audioRetentionCard() {
    return this.card("Audio File Retention");
  }

  audioRetentionSelect() {
    return this.audioRetentionCard().getByRole("combobox");
  }

  audioRetentionCustomInput() {
    return this.audioRetentionCard().locator('input[type="number"]');
  }

  // Native selects on this page (for UX audit — visual consistency check)
  async countNativeSelects() {
    return this.page.locator("main select").count();
  }
}
