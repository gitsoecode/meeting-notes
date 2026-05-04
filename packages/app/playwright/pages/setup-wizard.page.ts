import type { Locator, Page } from "@playwright/test";

export class SetupWizardPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  brand() {
    return this.page.getByText("Gistlist setup");
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
    return this.page.getByRole("heading", { name: "Welcome to Gistlist" });
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

  permissionsHeading() {
    return this.page.getByRole("heading", { name: "Permissions" });
  }

  depsHeading() {
    // v0.1.10 retitled the step from "Dependencies" to "Setting up Gistlist"
    // when the per-row install buttons were replaced by the chain UI.
    return this.page.getByRole("heading", { name: "Setting up Gistlist" });
  }

  // Permissions step controls
  grantMicButton() {
    return this.page.getByRole("button", { name: /grant microphone access/i });
  }

  testSystemAudioButton() {
    return this.page.getByRole("button", { name: /^test system audio$/i });
  }

  reTestSystemAudioButton() {
    return this.page.getByRole("button", { name: /^re-test$/i });
  }

  verifySystemAudioButton() {
    return this.page.getByRole("button", { name: /^verify$/i });
  }

  recheckMicButton() {
    return this.page.getByRole("button", {
      name: /re-check microphone permission/i,
    });
  }

  /**
   * Convenience: walk from the Permissions step into the Dependencies
   * step, granting the mic if needed (Next is disabled until granted).
   * Used by specs that don't care about the Permissions UI itself.
   */
  async advanceFromPermissionsToDeps() {
    const grant = this.grantMicButton();
    if (await grant.isVisible().catch(() => false)) {
      await grant.click();
    }
    await this.nextButton().click();
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
    return this.page.getByPlaceholder("/Users/you/Documents/Gistlist");
  }

  pickDataDirButton() {
    return this.page.getByRole("button", { name: "Pick…" }).last();
  }

  // Step 3: Transcription
  asrProviderSelect() {
    return this.page.getByRole("combobox").first();
  }

  llmProviderSelect() {
    return this.page.getByRole("combobox").nth(1);
  }

  /** @deprecated misnomer — selects LLM *provider*, not model. Use llmProviderSelect(). */
  localLlmToggle() {
    return this.llmProviderSelect();
  }

  localModelSelect() {
    return this.page.getByTestId("local-llm-select");
  }

  localModelPicker() {
    return this.page.getByTestId("local-llm-picker");
  }

  apiKeyInput() {
    return this.page.locator('input[type="password"]').first();
  }

  // Step 4: Dependencies — chain-install UI (v0.1.10).
  //
  // Each row in the checklist has `data-testid="dep-row-<id>"` and a
  // `data-state` attribute (pending|ready|running|done|failed|cancelled)
  // for state-aware assertions without scraping pixel layout.
  dependencyChecklist() {
    return this.page.getByTestId("dependency-checklist");
  }

  depRow(id: "ffmpeg" | "parakeet" | "ollama" | "embed-model" | "local-llm") {
    return this.page.getByTestId(`dep-row-${id}`);
  }

  /**
   * Install-all primary button. Visible in idle state when at least one
   * dep is missing. Label includes the rough total bytes ("Install all
   * (~1.4 GB)"); a regex match keeps the assertion robust to size shifts
   * as bundled binary versions tick.
   */
  installAllButton() {
    return this.page.getByRole("button", { name: /^install all/i });
  }

  /** Cancel button visible during a running chain. */
  cancelChainButton() {
    return this.page.getByRole("button", { name: /^cancel$/i });
  }

  /**
   * Footer Retry button visible when the chain is paused on a failure.
   * Distinct from the per-row Retry button (`dep-row-retry`) — the
   * `.last()` skips past any per-row Retry that's also visible.
   */
  chainRetryButton() {
    return this.page.getByRole("button", { name: /^retry$/i }).last();
  }

  /** Resume button visible after the chain was cancelled. */
  resumeChainButton() {
    return this.page.getByRole("button", { name: /^resume install/i });
  }

  activityLog() {
    return this.page.getByTestId("install-activity-log");
  }

  /** Per-row error text under a failed dep. */
  depRowError(id: "ffmpeg" | "parakeet" | "ollama" | "embed-model" | "local-llm") {
    return this.page.getByTestId(`dep-row-${id}-error`);
  }
}
