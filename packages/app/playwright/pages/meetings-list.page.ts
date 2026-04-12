import type { Locator, Page } from "@playwright/test";

export class MeetingsListPage {
  readonly page: Page;
  readonly main: Locator;

  constructor(page: Page) {
    this.page = page;
    this.main = page.locator("main");
  }

  heading() {
    return this.page.locator("header h1").filter({ hasText: "Meetings" });
  }

  emptyState() {
    return this.main.getByText("No meetings yet");
  }

  searchInput() {
    return this.main.getByPlaceholder("Search meetings…");
  }

  refreshButton() {
    return this.main.getByRole("button", { name: "Refresh" });
  }

  importButton() {
    return this.main.getByRole("button", { name: /Import meeting/ });
  }

  selectAllCheckbox() {
    return this.main.getByRole("checkbox", { name: "Select all" });
  }

  bulkRunButton() {
    return this.main.getByRole("button", { name: /Run prompt on \d+/ });
  }

  meetingRow(title: string) {
    return this.main.locator("tbody tr").filter({ hasText: new RegExp(title, "i") }).first();
  }

  checkboxes() {
    return this.main.getByRole("checkbox").filter({ hasNot: this.page.getByLabel("Select all") });
  }

  meetingCheckbox(title: string) {
    return this.main.getByRole("checkbox", { name: new RegExp(`Select ${title}`, "i") });
  }

  statusBadge(status: string) {
    return this.main.getByText(new RegExp(`^${status}$`, "i")).first();
  }

  quickActionsCard() {
    return this.main.getByRole("button", { name: /Import meeting/ });
  }

  totalBadge() {
    return this.main.getByText(/\d+ meetings/);
  }

  // Bulk run modal
  bulkRunModalHeading() {
    return this.page.getByRole("heading", { name: /Run prompt on \d+ meeting/ });
  }

  bulkRunModalRunButton() {
    return this.page.getByRole("dialog").getByRole("button", { name: "Run" });
  }

  bulkRunModalDoneButton() {
    return this.page.getByRole("dialog").getByRole("button", { name: "Done" });
  }

  bulkRunPromptSummary() {
    return this.page.getByTestId("prompt-run-summary");
  }

  bulkDeleteButton() {
    return this.main.getByRole("button", { name: /Delete \d+/ });
  }

  confirmDeleteButton() {
    return this.page.getByRole("button", { name: /^Delete$/ });
  }

  cancelDeleteButton() {
    return this.page.getByRole("button", { name: "Cancel" });
  }

  async waitForReady() {
    await this.heading().waitFor();
    await this.searchInput().waitFor();
    await this.main.locator("table").waitFor();
  }

  // Column header row — the grid structure
  columnHeaders() {
    return this.main.locator(".grid-cols-\\[44px_minmax\\(0\\,1\\.3fr\\)_180px_120px_120px\\]").first();
  }

  // Individual meeting row cells (these are separate button elements — a known UX issue)
  meetingRowButtons(title: string) {
    const row = this.main.locator(`div:has(> button:has-text("${title}"))`).first();
    return row.getByRole("button");
  }
}
