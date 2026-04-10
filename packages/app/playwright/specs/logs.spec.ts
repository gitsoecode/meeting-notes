import { test, expect } from "../fixtures/base.fixture";

test.describe("Activity", () => {
  test.beforeEach(async ({ app }) => {
    await app.navigateTo("Activity");
  });

  test("app log content is visible in cli-style view", async ({ logsView, page }) => {
    await expect(page.getByText("Prompt run failed to render preview")).toBeVisible();
    await expect(page.getByText("renderer")).toBeVisible();
  });

  test("run log selection changes content", async ({ logsView, page }) => {
    await logsView.runSelect().click();
    const options = page.getByRole("option");
    const optionCount = await options.count();
    if (optionCount > 1) {
      await options.nth(1).click();
    }
    await expect(logsView.logContent()).toContainText("log for job");
  });

  test("filters logs by search and severity", async ({ logsView, page }) => {
    await logsView.searchInput().fill("renderer");
    await expect(page.getByText("Prompt run failed to render preview")).toBeVisible();
    await logsView.severityFilter().click();
    await page.getByRole("option", { name: "Errors" }).click();
    await expect(page.getByText("Prompt run failed to render preview")).toBeVisible();
  });

  test("only errors toggle works", async ({ logsView, page }) => {
    await logsView.onlyErrorsSwitch().click();
    await expect(page.getByText("Prompt run failed to render preview")).toBeVisible();
    await expect(page.getByText("Retrying pipeline section")).toHaveCount(0);
  });

  test("process lines are visible", async ({ logsView, page }) => {
    await expect(logsView.processStrip()).toBeVisible();
    await expect(page.getByText("Ollama daemon")).toBeVisible();
  });

  test("heading shows Activity", async ({ logsView, page }) => {
    await expect(logsView.heading()).toContainText("Activity");
    await expect(logsView.jobsHeading()).toBeVisible();
    await page.screenshot({
      path: "test-results/screenshots/activity-view.png",
      fullPage: true,
    });
  });
});
