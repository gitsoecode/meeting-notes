import type { AppLogLevel } from "../../shared/ipc";
import type { Locator, Page } from "@playwright/test";

export class LogsViewPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  heading() {
    return this.page.getByRole("heading", { name: "Activity" }).first();
  }

  jobsHeading() {
    return this.page.getByRole("heading", { name: "Jobs" });
  }

  runtimeStatus() {
    return this.page.getByTestId("runtime-status");
  }

  runtimeModels() {
    return this.page.getByTestId("runtime-models");
  }

  revealAppLogButton() {
    return this.page.getByRole("button", { name: "Reveal app.log" });
  }

  revealOllamaLogButton() {
    return this.page.getByRole("button", { name: "Reveal ollama.log" });
  }

  jobsGroup(group: "failed" | "running" | "queued" | "history") {
    return this.page.getByTestId(`jobs-group-${group}`);
  }

  filterLogsButton(jobId: string) {
    return this.page.getByTestId(`job-row-filter-${jobId}`);
  }

  scopeStrip() {
    return this.page.getByTestId("log-scope-strip");
  }

  clearScopeButton() {
    return this.page.getByTestId("log-scope-clear");
  }

  viewRawRunLogButton() {
    return this.page.getByTestId("log-scope-view-raw");
  }

  viewJobEventsButton() {
    return this.page.getByTestId("log-scope-view-events");
  }

  searchInput() {
    return this.page.getByRole("textbox", { name: "Search logs" });
  }

  severityToggle(level: "all" | AppLogLevel) {
    return this.page.getByTestId(`severity-${level}`);
  }

  followCheckbox() {
    return this.page.getByRole("switch", { name: "Follow logs" });
  }

  logScroller() {
    return this.page.getByTestId("log-scroller");
  }

  logRows(): Locator {
    return this.page.getByTestId("log-row");
  }

  expandedPanel() {
    return this.page.getByTestId("log-row-expanded");
  }

  noMatchingLines() {
    return this.page.getByText("(no matching log lines)");
  }
}
