import { test, expect } from "../fixtures/base.fixture";

test.describe("Meeting Workspace", () => {
  test.beforeEach(async ({ app, meetingsList, meetingDetail }) => {
    await app.navigateTo("Meetings");
    await meetingsList.waitForReady();
    await meetingsList.meetingRow("Weekly planning").click();
    await meetingDetail.waitForReady();
  });

  test("loads the workspace with the current tab set", async ({ meetingDetail }) => {
    await expect(meetingDetail.tab("Metadata")).toHaveAttribute("data-state", "active");
    await expect(meetingDetail.tab("Prep")).toBeVisible();
    await expect(meetingDetail.tab("Notes")).toBeVisible();
    await expect(meetingDetail.tab("Summary")).toBeVisible();
    await expect(meetingDetail.tab("Analysis")).toBeVisible();
    await expect(meetingDetail.tab("Transcript")).toBeVisible();
    await expect(meetingDetail.tab("Recording")).toBeVisible();
    await expect(meetingDetail.tab("Files")).toBeVisible();
  });

  test("summary tab shows output and can refresh", async ({ meetingDetail, page }) => {
    await meetingDetail.tab("Summary").click();
    await expect(page.getByText("Highlights")).toBeVisible();
    await meetingDetail.refreshSummaryButton().click();
    await expect(page.getByText("Clarified pricing next steps.")).toBeVisible();
  });

  test("analysis tab shows existing and missing outputs", async ({ meetingDetail, page }) => {
    await meetingDetail.tab("Analysis").click();
    await meetingDetail.promptSidebarItem("Decision Log").click();
    await expect(page.getByRole("heading", { name: "Decisions" })).toBeVisible();

    await meetingDetail.promptSidebarItem("1:1 Follow-up").click();
    await expect(page.getByText("This prompt has not produced output for this meeting yet.")).toBeVisible();
    await meetingDetail.runPromptButton().click();
    await expect(page.getByRole("heading", { name: "Follow-up", exact: true })).toBeVisible();
  });

  test("notes and transcript tabs render meeting content", async ({ meetingDetail, page }) => {
    await meetingDetail.tab("Notes").click();
    await expect(page.getByText("These are the notes I found:")).toBeVisible();

    await meetingDetail.tab("Transcript").click();
    await expect(page.getByText("Welcome everyone.")).toBeVisible();
  });

  test("recording and files tabs show stored artifacts", async ({ meetingDetail, page }) => {
    await meetingDetail.tab("Recording").click();
    await expect(page.getByText("audio/mic.wav")).toBeVisible();
    await expect(page.locator("audio")).toHaveCount(2);

    await meetingDetail.tab("Files").click();
    await expect(page.getByText("Attached files (1)")).toBeVisible();
    await expect(page.getByText("agenda.pdf")).toBeVisible();
  });

  test("can reopen a complete meeting as a draft and continue recording", async ({
    meetingDetail,
    page,
  }) => {
    await meetingDetail.moreActionsButton().click();
    await meetingDetail.editAsDraftItem().click();
    await expect(page.getByText("draft").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Start recording" })).toBeVisible();
    await page.getByRole("button", { name: "Start recording" }).click();
    await expect(page.getByRole("button", { name: "End meeting" })).toBeVisible();
  });

  test("delete cancels and confirms cleanly", async ({ meetingDetail, page }) => {
    await meetingDetail.moreActionsButton().click();
    await meetingDetail.deleteButton().click();
    await page.getByRole("button", { name: "Keep meeting" }).click();
    await expect(meetingDetail.tab("Metadata")).toBeVisible();

    await meetingDetail.moreActionsButton().click();
    await meetingDetail.deleteButton().click();
    await page.getByRole("button", { name: "Delete meeting" }).click();
    await expect(page.locator("header h1")).toContainText("Meetings");
  });
});
