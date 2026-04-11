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
    return this.page.getByRole("button").filter({ has: this.page.locator("svg.lucide-folder-open") }).first();
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
      name: "Install / reinstall Parakeet",
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

  pullModelInput() {
    return this.card("Local Models").getByRole("combobox").first();
  }

  pullCustomModelInput() {
    return this.page.getByPlaceholder(/model id/i).last();
  }

  pullButton() {
    return this.card("Local Models").getByRole("button", { name: "Pull" });
  }

  // Shortcuts card
  shortcutRecorder() {
    return this.card("Keyboard Shortcuts").getByText("Toggle recording").locator("..").locator("..");
  }

  // Dependencies card
  dependenciesCard() {
    return this.card("System Health");
  }

  depRefreshButton() {
    return this.page.getByRole("button", { name: "Refresh" }).last();
  }

  depRow(name: string) {
    return this.dependenciesCard().getByText(name, { exact: false });
  }

  // Native selects on this page (for UX audit — visual consistency check)
  async countNativeSelects() {
    return this.page.locator("main select").count();
  }
}
