import { test, expect } from "../fixtures/base.fixture";

test.describe("Meeting Detail", () => {
  test.beforeEach(async ({ app, page }) => {
    // Navigate to completed meeting "Weekly planning"
    await app.navigateTo("Meetings");
    await page.getByRole("row", { name: /Weekly planning/ }).click();
    await expect(page.getByRole("tab", { name: "Summary" })).toBeVisible();
  });

  test("Summary tab is the default active tab", async ({ meetingDetail }) => {
    await expect(meetingDetail.tab("Summary")).toHaveAttribute(
      "data-state",
      "active"
    );
  });

  test("tabs appear in correct order: Summary, Analysis, Notes, Transcript, Recording, Metadata", async ({
    meetingDetail,
  }) => {
    const tabs = meetingDetail.allTabs();
    await expect(tabs).toHaveCount(6);
    await expect(tabs.nth(0)).toHaveText("Summary");
    await expect(tabs.nth(1)).toHaveText("Analysis");
    await expect(tabs.nth(2)).toHaveText("Notes");
    await expect(tabs.nth(3)).toHaveText("Transcript");
    await expect(tabs.nth(4)).toHaveText("Recording");
    await expect(tabs.nth(5)).toHaveText("Metadata");
  });

  test("summary tab shows the primary recap and summary-specific actions", async ({
    meetingDetail,
    page,
  }) => {
    await expect(page.getByText("Primary prompt")).toBeVisible();
    await expect(page.getByText("Locked sprint scope.")).toBeVisible();
    await expect(meetingDetail.refreshSummaryButton()).toBeVisible();
    await expect(meetingDetail.editSummaryPromptButton()).toBeVisible();
    await expect(meetingDetail.runPromptButton()).not.toBeVisible();
  });

  test("refresh summary reruns only the primary summary output", async ({
    meetingDetail,
    page,
  }) => {
    await meetingDetail.refreshSummaryButton().click();
    await expect(page.getByText("Clarified pricing next steps.")).toBeVisible();
  });

  test("analysis tab shows non-summary prompts and clicking selects them", async ({
    meetingDetail,
    page,
  }) => {
    await meetingDetail.tab("Analysis").click();
    await expect(meetingDetail.promptSidebarItem("Decision Log")).toBeVisible();
    await expect(meetingDetail.promptSidebarItem("1:1 Follow-up")).toBeVisible();

    // Click Decision Log
    await meetingDetail.promptSidebarItem("Decision Log").click();
    // Content should load
    await expect(page.getByRole("heading", { name: "Decision Log" })).toBeVisible();
    await expect(page.getByText("Decisions")).toBeVisible();
  });

  test("analysis tab shows a run CTA when a prompt has no output yet", async ({
    meetingDetail,
    page,
  }) => {
    await meetingDetail.tab("Analysis").click();
    await meetingDetail.promptSidebarItem("1:1 Follow-up").click();
    await expect(
      page.getByText("This prompt has not produced an output for this meeting yet.")
    ).toBeVisible();
    await expect(meetingDetail.runPromptButton()).toBeVisible();
  });

  test("summary tab can jump to the primary prompt in Prompt Library", async ({
    meetingDetail,
    promptsEditor,
  }) => {
    await meetingDetail.editSummaryPromptButton().click();
    await expect(promptsEditor.workspaceBadge()).toBeVisible();
    await expect(promptsEditor.titleInput()).toHaveValue("Summary + Action Items");
  });

  test("Notes tab: completed meeting shows read mode with Edit button", async ({
    meetingDetail,
    page,
  }) => {
    await meetingDetail.tab("Notes").click();
    await expect(meetingDetail.notesReadModeHeading()).toBeVisible();
    await expect(meetingDetail.editNotesButton()).toBeVisible();
    await expect(page.getByText("These are the notes I found:")).toBeVisible();
    await expect(page.getByText("<br />")).toHaveCount(0);

    await page.screenshot({
      path: "test-results/screenshots/meeting-notes-read-mode.png",
      fullPage: true,
    });
  });

  test("Notes tab: edit flow with Save and Cancel", async ({
    meetingDetail,
  }) => {
    await meetingDetail.tab("Notes").click();
    await meetingDetail.editNotesButton().click();

    await expect(meetingDetail.saveNotesButton()).toBeVisible();
    await expect(meetingDetail.notesCancelButton()).toBeVisible();

    // Cancel returns to read mode
    await meetingDetail.notesCancelButton().click();
    await expect(meetingDetail.editNotesButton()).toBeVisible();
    await expect(meetingDetail.saveNotesButton()).not.toBeVisible();
  });

  test("Notes tab: save flow", async ({ meetingDetail }) => {
    await meetingDetail.tab("Notes").click();
    await meetingDetail.editNotesButton().click();
    await meetingDetail.saveNotesButton().click();
    // After save, returns to read mode
    await expect(meetingDetail.editNotesButton()).toBeVisible();
  });

  test("Transcript tab shows transcript content", async ({
    meetingDetail,
    page,
  }) => {
    await meetingDetail.tab("Transcript").click();
    await expect(page.getByText("Welcome everyone.")).toBeVisible();
    await expect(
      page.getByText("We need to lock the sprint scope.")
    ).toBeVisible();

    await page.screenshot({
      path: "test-results/screenshots/meeting-transcript.png",
      fullPage: true,
    });
  });

  test("Recording tab lists source recordings and audio previews", async ({
    meetingDetail,
    page,
  }) => {
    await meetingDetail.tab("Recording").click();
    await expect(page.getByText("audio/mic.wav")).toBeVisible();
    await expect(page.getByText("audio/system.wav")).toBeVisible();
    await expect(page.locator("audio")).toHaveCount(2);
    await expect(meetingDetail.downloadRecordingButton()).toBeVisible();
  });

  test("Recording delete uses a dialog and refreshes the list", async ({
    meetingDetail,
    page,
  }) => {
    await meetingDetail.tab("Recording").click();
    await meetingDetail.deleteRecordingButton().click();
    await expect(meetingDetail.deleteRecordingDialogTitle()).toBeVisible();
    await page.getByRole("button", { name: "Delete recording" }).click();
    await expect(page.getByText("audio/mic.wav")).not.toBeVisible();
  });

  test("Metadata tab shows run details", async ({ meetingDetail, page }) => {
    await meetingDetail.tab("Metadata").click();
    await expect(meetingDetail.metadataHeading()).toBeVisible();

    await page.screenshot({
      path: "test-results/screenshots/meeting-metadata.png",
      fullPage: true,
    });
  });

  test("Reprocess modal opens and can be cancelled", async ({
    meetingDetail,
  }) => {
    await meetingDetail.reprocessButton().click();
    await expect(meetingDetail.reprocessModalHeading()).toBeVisible();
    await expect(meetingDetail.page.getByText("Choose prompts")).toBeVisible();
    await expect(meetingDetail.reprocessScopeSelect()).toBeVisible();
    await meetingDetail.modalCancelButton().click();
    await expect(meetingDetail.reprocessModalHeading()).not.toBeVisible();
  });

  test("Reprocess modal lets you choose specific prompts", async ({
    meetingDetail,
    page,
  }) => {
    await meetingDetail.reprocessButton().click();
    await meetingDetail.reprocessScopeButton("Pick specific prompts").click();
    await expect(meetingDetail.reprocessPromptOption("Decision Log")).toBeVisible();
    await meetingDetail.reprocessPromptOption("Decision Log").click();
    await meetingDetail.reprocessScopeSelect().click();
    await page.getByRole("option", { name: /Full \(Everything\)/ }).click();
    await meetingDetail.modalRunButton().click();
    await expect(meetingDetail.reprocessModalHeading()).not.toBeVisible();
  });

  test("Reprocess modal allows changing scope", async ({
    meetingDetail,
  }) => {
    await meetingDetail.reprocessButton().click();
    await meetingDetail.reprocessScopeSelect().click();
    await meetingDetail.page.getByRole("option", { name: /Full \(Everything\)/ }).click();
    await expect(meetingDetail.reprocessScopeSelect()).toContainText("Full (Everything)");
    await meetingDetail.modalCancelButton().click();
  });

  test("analysis run prompt reruns the selected prompt directly", async ({
    meetingDetail,
    page,
  }) => {
    await meetingDetail.tab("Analysis").click();
    await meetingDetail.promptSidebarItem("1:1 Follow-up").click();
    await meetingDetail.runPromptButton().click();
    await expect(page.getByText("Follow-up")).toBeVisible();
  });

  test("analysis tab keeps the prompt chrome minimal", async ({
    meetingDetail,
    page,
  }) => {
    await meetingDetail.tab("Analysis").click();
    await expect(page.getByRole("button", { name: "New prompt" })).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Edit in Prompt Library" })).not.toBeVisible();
  });

  test("Delete dismisses when confirm is cancelled", async ({
    meetingDetail,
    page,
  }) => {
    await meetingDetail.moreActionsButton().click();
    await meetingDetail.deleteButton().click();
    await meetingDetail.modalCancelButton().click();
    // Should still be on meeting detail
    await expect(meetingDetail.tab("Summary")).toBeVisible();
  });

  test("Delete navigates back when confirmed", async ({
    meetingDetail,
    page,
  }) => {
    await meetingDetail.moreActionsButton().click();
    await meetingDetail.deleteButton().click();
    await page.getByRole("button", { name: "Delete meeting" }).click();
    // Should navigate back to meetings list
    await expect(page.getByText("Meetings on disk")).toBeVisible();
  });

  test("Back button returns to meetings list", async ({ meetingDetail, page }) => {
    await meetingDetail.backButton().click();
    await expect(page.getByText("Meetings on disk")).toBeVisible();
  });

  test("processing state displays for in-progress meeting", async ({
    app,
    page,
  }) => {
    // Go back to home first, then navigate to Customer call via Meetings
    await app.navigateTo("Meetings");
    await page.getByText("Customer call").first().click();
    await expect(
      page.getByText("Processing locally with qwen3.5:9b")
    ).toBeVisible();

    await page.screenshot({
      path: "test-results/screenshots/meeting-processing.png",
      fullPage: true,
    });
  });

  test("analysis output appears after processing completes without navigating away", async ({
    app,
    meetingDetail,
    page,
  }) => {
    await app.navigateTo("Meetings");
    await page.getByText("Customer call").first().click();

    await expect(page.getByText("No summary has been generated for this meeting yet.")).toBeVisible();
    await expect(page.getByText("Clarified pricing next steps.")).not.toBeVisible();

    await meetingDetail.reprocessButton().click();
    await expect(meetingDetail.reprocessModalHeading()).toBeVisible();
    await meetingDetail.modalRunButton().click();
    await expect(meetingDetail.reprocessModalHeading()).not.toBeVisible();

    await expect(page.getByText("Clarified pricing next steps.")).toBeVisible();
  });

  test("screenshots of all tabs", async ({ meetingDetail, page }) => {
    await page.screenshot({
      path: "test-results/screenshots/meeting-summary-tab.png",
      fullPage: true,
    });

    await meetingDetail.tab("Analysis").click();
    await page.screenshot({
      path: "test-results/screenshots/meeting-analysis-tab.png",
      fullPage: true,
    });

    await meetingDetail.tab("Notes").click();
    await page.screenshot({
      path: "test-results/screenshots/meeting-notes-tab.png",
      fullPage: true,
    });

    await meetingDetail.tab("Transcript").click();
    await page.screenshot({
      path: "test-results/screenshots/meeting-transcript-tab.png",
      fullPage: true,
    });

    await meetingDetail.tab("Recording").click();
    await page.screenshot({
      path: "test-results/screenshots/meeting-recording-tab.png",
      fullPage: true,
    });

    await meetingDetail.tab("Metadata").click();
    await page.screenshot({
      path: "test-results/screenshots/meeting-metadata-tab.png",
      fullPage: true,
    });
  });
});
