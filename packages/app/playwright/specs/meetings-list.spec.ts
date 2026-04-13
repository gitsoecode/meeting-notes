import { test, expect } from "../fixtures/base.fixture";

test.describe("Meetings List", () => {
  test.beforeEach(async ({ app }) => {
    await app.navigateTo("Meetings");
  });

  test("loads with meetings and shows heading", async ({ meetingsList }) => {
    await expect(meetingsList.heading()).toBeVisible();
    await expect(meetingsList.meetingRow("Weekly planning")).toBeVisible();
    await expect(meetingsList.meetingRow("Customer call")).toBeVisible();
  });

  test("search filters meetings", async ({ meetingsList }) => {
    await meetingsList.searchInput().fill("customer");
    await expect(meetingsList.meetingRow("Customer call")).toBeVisible();
    await expect(meetingsList.meetingRow("Weekly planning")).not.toBeVisible();

    await meetingsList.searchInput().clear();
    await expect(meetingsList.meetingRow("Weekly planning")).toBeVisible();
  });

  test("checkbox selection shows bulk run button", async ({
    meetingsList,
    page,
  }) => {
    await meetingsList.meetingCheckbox("Customer call").click();
    await expect(meetingsList.bulkRunButton()).toBeVisible();

    await page.screenshot({
      path: "test-results/screenshots/meetings-list-bulk-selected.png",
      fullPage: true,
    });
  });

  test("select all toggles visible meetings and shows both bulk actions", async ({
    meetingsList,
  }) => {
    await meetingsList.selectAllCheckbox().click();
    await expect(meetingsList.bulkRunButton()).toBeVisible();
    await expect(meetingsList.bulkDeleteButton()).toBeVisible();
  });

  test("bulk run modal flow: select prompt, run, done", async ({
    meetingsList,
  }) => {
    await meetingsList.meetingCheckbox("Customer call").click();
    await meetingsList.bulkRunButton().click();

    await expect(meetingsList.bulkRunModalHeading()).toBeVisible();
    await expect(meetingsList.bulkRunPromptSummary()).toContainText("Summary + Action Items");
    await expect(meetingsList.bulkRunPromptSummary()).toContainText("qwen3.5:9b");
    await expect(meetingsList.bulkRunPromptSummary()).toContainText(
      "Default meeting prompt for most meetings."
    );
    await meetingsList.bulkRunModalRunButton().click();

    // After run completes, Done button should appear
    await expect(meetingsList.bulkRunModalDoneButton()).toBeVisible();
    await meetingsList.bulkRunModalDoneButton().click();

    // Modal should close
    await expect(meetingsList.bulkRunModalHeading()).not.toBeVisible();
  });

  test("bulk run modal shows empty-state hint when prompt lacks a description", async ({
    meetingsList,
    page,
  }) => {
    await meetingsList.meetingCheckbox("Customer call").click();
    await meetingsList.bulkRunButton().click();

    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: /1:1 Follow-up \(manual\)/ }).click();
    await expect(meetingsList.bulkRunPromptSummary()).toContainText(
      "No description yet. Add one in Prompt Library under Details."
    );
  });

  test("clicking meeting row navigates to detail", async ({
    meetingsList,
    page,
  }) => {
    await meetingsList.meetingRow("Weekly planning").click();
    await expect(
      page.getByRole("tab", { name: "Analysis" })
    ).toBeVisible();
  });

  test("bulk delete cancel keeps selected meetings visible", async ({
    meetingsList,
    page,
  }) => {
    await meetingsList.meetingCheckbox("Weekly planning").click();
    await meetingsList.bulkDeleteButton().click();
    await meetingsList.cancelDeleteButton().click();
    await expect(meetingsList.meetingRow("Weekly planning")).toBeVisible();
    await expect(meetingsList.bulkDeleteButton()).toBeVisible();
  });

  test("bulk delete can clear the list into its empty state", async ({
    meetingsList,
    page,
  }) => {
    await meetingsList.selectAllCheckbox().click();
    await meetingsList.bulkDeleteButton().click();
    await meetingsList.confirmDeleteButton().click();
    await expect(meetingsList.emptyState()).toBeVisible();
    await expect(page.getByText("Start a recording from Home, or drop a file here to import.")).toBeVisible();
  });

  test("status badges show correct values", async ({ meetingsList, page }) => {
    await expect(meetingsList.statusBadge("complete")).toBeVisible();
    await expect(meetingsList.statusBadge("processing")).toBeVisible();

    await page.screenshot({
      path: "test-results/screenshots/meetings-list-full.png",
      fullPage: true,
    });
  });
});
