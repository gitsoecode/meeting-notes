import type { Locator, Page } from "@playwright/test";

export class LogsViewPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  appLogButton() {
    return this.page.getByRole("combobox", { name: "Log source" });
  }

  runSelect() {
    return this.page.getByRole("combobox", { name: "Log source" });
  }

  followCheckbox() {
    // Now a shadcn Switch with aria-label="Follow logs"
    return this.page.getByRole("switch", { name: "Follow logs" });
  }

  logContent() {
    return this.page.locator(".font-mono").last();
  }

  searchInput() {
    return this.page.getByRole("textbox", { name: "Search logs" });
  }

  severityFilter() {
    return this.page.getByRole("combobox", { name: "Severity filter" });
  }

  onlyErrorsSwitch() {
    return this.page.getByRole("button", { name: "Only errors" });
  }

  processStrip() {
    return this.page.getByText(/daemon · pid|capture · pid/i).first();
  }

  noMatchingLines() {
    return this.page.getByText("(no matching log lines)");
  }

  heading() {
    return this.page.getByRole("heading", { name: "Activity" }).first();
  }

  jobsHeading() {
    return this.page.getByRole("heading", { name: "Jobs" });
  }
}
