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
    return this.page.locator(".wizard-progress-dot");
  }

  activeDot() {
    return this.page.locator(".wizard-progress-dot.active");
  }

  doneDots() {
    return this.page.locator(".wizard-progress-dot.done");
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
      name: "Transcription & API keys",
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
    // The checkbox input is hidden (CSS toggle); click the .switch label wrapper
    return this.page.locator("label.switch").first();
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

  // Step 3: Transcription
  asrProviderSelect() {
    return this.page.locator(".wizard-step select").first();
  }

  localLlmToggle() {
    // Click the .switch label wrapper (not the hidden checkbox input)
    return this.page.locator("label.switch").last();
  }

  apiKeyInput() {
    return this.page.locator('input[type="password"]').first();
  }

  // Step 4: Dependencies
  depRowByName(name: string) {
    return this.page.getByText(name, { exact: false });
  }

  skipBlackholeCheckbox() {
    return this.page.getByText("Skip — I don't need to capture");
  }
}
