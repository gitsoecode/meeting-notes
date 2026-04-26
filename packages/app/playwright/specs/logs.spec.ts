import { test, expect } from "../fixtures/base.fixture";

test.describe("Activity", () => {
  test.beforeEach(async ({ app }) => {
    await app.navigateTo("Activity");
  });

  test("heading and section structure", async ({ logsView }) => {
    await expect(logsView.heading()).toContainText("Activity");
    await expect(logsView.jobsHeading()).toBeVisible();
    await expect(logsView.runtimeStatus()).toBeVisible();
  });

  test("runtime shows daemon source and base URL", async ({ logsView }) => {
    await expect(logsView.runtimeStatus()).toContainText("Running on http://127.0.0.1:11434");
    await expect(logsView.runtimeStatus()).toContainText("system");
  });

  test("runtime model list shows VRAM and relative expiry", async ({ logsView }) => {
    await expect(logsView.runtimeModels()).toContainText("qwen3.5:9b");
    await expect(logsView.runtimeModels()).toContainText("VRAM");
    await expect(logsView.runtimeModels()).toContainText(/m left|h left/);
  });

  test("app log content visible in cli-style scroller", async ({ logsView, page }) => {
    await expect(logsView.logScroller()).toBeVisible();
    await expect(page.getByText("Prompt run failed to render preview")).toBeVisible();
    await expect(page.getByText("renderer")).toBeVisible();
  });

  test("search filters log lines", async ({ logsView, page }) => {
    await logsView.searchInput().fill("renderer");
    await expect(page.getByText("Prompt run failed to render preview")).toBeVisible();
    await expect(page.getByText("Retrying pipeline section")).toHaveCount(0);
  });

  test("severity ToggleGroup: All semantics", async ({ logsView, page }) => {
    await expect(logsView.severityToggle("all")).toHaveAttribute("data-state", "on");

    await logsView.severityToggle("error").click();
    await expect(logsView.severityToggle("all")).toHaveAttribute("data-state", "off");
    await expect(logsView.severityToggle("error")).toHaveAttribute("data-state", "on");
    await expect(page.getByText("Prompt run failed to render preview")).toBeVisible();
    await expect(page.getByText("Retrying pipeline section")).toHaveCount(0);

    await logsView.severityToggle("error").click();
    await expect(logsView.severityToggle("all")).toHaveAttribute("data-state", "on");
    await expect(page.getByText("Retrying pipeline section")).toBeVisible();
  });

  test("All button clears active level filters", async ({ logsView }) => {
    await logsView.severityToggle("error").click();
    await logsView.severityToggle("warn").click();
    await expect(logsView.severityToggle("all")).toHaveAttribute("data-state", "off");

    await logsView.severityToggle("all").click();
    await expect(logsView.severityToggle("all")).toHaveAttribute("data-state", "on");
    await expect(logsView.severityToggle("warn")).toHaveAttribute("data-state", "off");
    await expect(logsView.severityToggle("error")).toHaveAttribute("data-state", "off");
  });

  test("follow switch toggles + empty filtered state", async ({ logsView }) => {
    await expect(logsView.followCheckbox()).toHaveAttribute("aria-checked", "true");
    await logsView.followCheckbox().click();
    await expect(logsView.followCheckbox()).toHaveAttribute("aria-checked", "false");

    await logsView.searchInput().fill("definitely-no-match");
    await expect(logsView.noMatchingLines()).toBeVisible();
  });

  test("log row with data payload expands to reveal it", async ({ logsView }) => {
    const errorRow = logsView.logRows().filter({ hasText: "Prompt run failed to render preview" }).first();
    await expect(errorRow).toHaveAttribute("data-expandable", "true");
    await errorRow.locator("button").first().click();
    await expect(logsView.expandedPanel()).toBeVisible();
    await expect(logsView.expandedPanel()).toContainText("retries");
  });

  test("plain log row without data has no expand affordance", async ({ logsView }) => {
    const plainRow = logsView.logRows().filter({ hasText: "Electron IPC handlers registered" }).first();
    await expect(plainRow).toHaveAttribute("data-expandable", "false");
    const button = plainRow.locator("button").first();
    await expect(button).toBeDisabled();
  });

  test("failed jobs surface in their own group", async ({ logsView, page }) => {
    await expect(logsView.jobsGroup("failed")).toBeVisible();
    await expect(logsView.jobsGroup("failed")).toContainText("Decision log run");
    await expect(page.getByText("Ollama returned 500")).toBeVisible();
  });

  test("clicking Filter logs scopes the log section to that jobId", async ({ logsView, page }) => {
    await logsView.filterLogsButton("job-1").click();
    await expect(logsView.scopeStrip()).toBeVisible();
    await expect(logsView.scopeStrip()).toContainText("Customer call");
    await expect(page.getByText("Retrying pipeline section")).toBeVisible();
    await expect(page.getByText("Prompt run failed to render preview")).toHaveCount(0);
  });

  test("Cancel button does not also trigger Filter logs", async ({ logsView }) => {
    const cancelButton = logsView.page
      .getByTestId("job-row-job-1")
      .getByRole("button", { name: "Cancel" });
    await cancelButton.click();
    await expect(logsView.scopeStrip()).toHaveCount(0);
  });

  test("Clear scope returns to all app events", async ({ logsView, page }) => {
    await logsView.filterLogsButton("job-1").click();
    await expect(logsView.scopeStrip()).toBeVisible();
    await logsView.clearScopeButton().click();
    await expect(logsView.scopeStrip()).toHaveCount(0);
    await expect(page.getByText("Prompt run failed to render preview")).toBeVisible();
  });

  test("View raw run log switches scope to job-file mode", async ({ logsView, page }) => {
    await logsView.filterLogsButton("job-1").click();
    await logsView.viewRawRunLogButton().click();
    await expect(logsView.scopeStrip()).toContainText("Raw run log");
    await expect(page.getByText("log for job job-1")).toBeVisible();
  });
});
