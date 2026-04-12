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

  // Audio card
  micDeviceSelect() {
    return this.page.locator("#settings-mic");
  }

  systemDeviceSelect() {
    return this.page.locator("#settings-sys-audio");
  }

  // Transcription card
  asrProviderSelect() {
    return this.page.locator("#settings-asr");
  }

  parakeetInstallButton() {
    return this.page.getByRole("button", {
      name: /Install Parakeet|Check \/ repair/,
    });
  }

  openaiWarning() {
    return this.page.getByText("OpenAI caps uploads at 25 MB");
  }

  // LLM card
  claudeKeyInput() {
    return this.card("AI Provider").getByPlaceholder(/paste key|••••• stored/).first();
  }

  claudeKeySaveButton() {
    return this.card("AI Provider").getByRole("button", { name: "Save" }).first();
  }

  openaiKeyInput() {
    return this.card("AI Provider").getByPlaceholder(/paste key|••••• stored/).nth(1);
  }

  openaiKeySaveButton() {
    return this.card("AI Provider").getByRole("button", { name: "Save" }).nth(1);
  }

  defaultModelCombobox() {
    return this.card("AI Provider").getByRole("combobox").first();
  }

  // Local models card
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

  pullModelInput() {
    return this.card("Local Models").getByRole("combobox").first();
  }

  pullCustomModelInput() {
    return this.page.getByPlaceholder(/model id/i).last();
  }

  pullButton() {
    return this.card("Local Models").getByRole("button", { name: "Pull" });
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
    return this.page.getByRole("dialog").getByRole("button", { name: /Run setup|Install/ });
  }

  setupParakeetCloseButton() {
    return this.page.getByRole("dialog").getByRole("button", { name: "Close" }).first();
  }

  depRow(name: string) {
    return this.dependenciesCard().getByText(name, { exact: false });
  }

  // Native selects on this page (for UX audit — visual consistency check)
  async countNativeSelects() {
    return this.page.locator("main select").count();
  }
}
