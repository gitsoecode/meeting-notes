import type { Locator, Page } from "@playwright/test";

export class MeetingsListPage {
  readonly page: Page;
  readonly main: Locator;

  constructor(page: Page) {
    this.page = page;
    this.main = page.locator("main");
  }

  heading() {
    return this.main.getByText("Recent and imported meetings");
  }

  emptyState() {
    return this.main.getByText("Import your first meeting");
  }

  searchInput() {
    return this.main.getByPlaceholder("Search meetings");
  }

  refreshButton() {
    return this.main.getByRole("button", { name: "Refresh" });
  }

  importButton() {
    return this.main.getByRole("button", { name: /Import meeting/ });
  }

  bulkRunButton() {
    return this.main.getByRole("button", { name: /Run prompt on \d+/ });
  }

  meetingRow(title: string) {
    return this.main.getByText(title).first();
  }

  checkboxes() {
    return this.main.locator('input[type="checkbox"]');
  }

  statusBadge(status: string) {
    return this.main.getByText(status, { exact: true });
  }

  quickActionsCard() {
    return this.main.getByText("Import or batch-run");
  }

  totalBadge() {
    return this.main.getByText(/\d+ total/);
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
