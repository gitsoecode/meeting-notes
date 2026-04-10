import type { Locator, Page } from "@playwright/test";

export class LogsViewPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  appLogButton() {
    return this.page.getByRole("option", { name: /App log/i }).or(
      this.page.getByRole("combobox")
    );
  }

  runSelect() {
    // shadcn Select component — click the trigger to open
    return this.page.getByRole("combobox");
  }

  followCheckbox() {
    // Now a shadcn Switch with aria-label="Follow logs"
    return this.page.getByRole("switch", { name: "Follow logs" });
  }

  logContent() {
    return this.page.locator('[class*="font-mono"]').last();
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
    return this.page.getByText(/pid/i);
  }

  heading() {
    return this.page.locator("h1");
  }

  jobsHeading() {
    return this.page.getByText("Jobs");
  }
}
