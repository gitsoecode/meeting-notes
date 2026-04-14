import type { Locator, Page } from "@playwright/test";

export class SetupWizardPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  brand() {
    return this.page.getByText("Meeting Notes setup");
  }

  progressDots() {
    return this.page.locator('div.h-1.flex-1.rounded-full');
  }

  activeDot() {
    return this.page.locator('div.h-1.flex-1.rounded-full.bg-\\[var\\(--accent\\)\\]');
  }

  doneDots() {
    return this.page.locator('div.h-1.flex-1.rounded-full.bg-\\[var\\(--success\\)\\]');
  }

  // Step headings
  welcomeHeading() {
    return this.page.getByRole("heading", { name: "Welcome to Meeting Notes" });
  }

  obsidianHeading() {
    return this.page.getByRole("heading", { name: "Do you use Obsidian?" });
  }

  dataDirHeading() {
    return this.page.getByRole("heading", {
      name: "Where should meetings be stored?",
    });
  }

  transcriptionHeading() {
    return this.page.getByRole("heading", {
      name: "Transcription & Summarization",
    });
  }

  depsHeading() {
    return this.page.getByRole("heading", { name: "Dependencies" });
  }

  // Navigation buttons
  getStartedButton() {
    return this.page.getByRole("button", { name: "Get started" });
  }

  nextButton() {
    return this.page.getByRole("button", { name: "Next" });
  }

  backButton() {
    return this.page.getByRole("button", { name: "Back" });
  }

  finishButton() {
    return this.page.getByRole("button", { name: "Finish setup" });
  }

  // Step 1: Obsidian
  obsidianToggle() {
    return this.page.locator("#wizard-use-obsidian");
  }

  vaultPathInput() {
    return this.page.getByPlaceholder("/Users/you/Obsidian/MyVault");
  }

  pickVaultButton() {
    return this.page.getByRole("button", { name: "Pick…" });
  }

  // Step 2: Data directory
  dataPathInput() {
    return this.page.getByPlaceholder("/Users/you/Documents/Meeting Notes");
  }

  pickDataDirButton() {
    return this.page.getByRole("button", { name: "Pick…" }).last();
  }

  // Step 3: Transcription
  asrProviderSelect() {
    return this.page.getByRole("combobox").first();
  }

  localLlmToggle() {
    return this.page.getByRole("combobox").nth(1);
  }

  apiKeyInput() {
    return this.page.locator('input[type="password"]').first();
  }

  // Step 4: Dependencies
  depRowByName(name: string) {
    return this.page.getByText(name, { exact: false });
  }

  recheckButton() {
    return this.page.getByRole("button", { name: "Re-check" });
  }

  installButton(name: string) {
    return this.page.getByRole("button", { name }).first();
  }
}
