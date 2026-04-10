import { test, expect } from "../fixtures/base.fixture";

test.describe("Home & Recording", () => {
  test("start recording with custom title shows live view", async ({
    recordView,
    page,
  }) => {
    await recordView.startRecording("Sprint Planning");
    await expect(recordView.recordingLiveBadge()).toBeVisible();
    await expect(page.getByText("Sprint Planning").first()).toBeVisible();
    await expect(recordView.elapsedTimer()).toBeVisible();
  });

  test("end and process navigates to the meeting workspace", async ({
    recordView,
    page,
  }) => {
    await recordView.startRecording("Test Meeting");
    await expect(recordView.recordingLiveBadge()).toBeVisible();

    await recordView.endAndProcessButton().click();

    // Should navigate to meeting detail
    await expect(page.getByText("Back to meetings")).toBeVisible();
  });

  test("end and delete confirms before discarding the live meeting", async ({
    recordView,
    page,
  }) => {
    await recordView.startRecording("Throwaway Meeting");
    await expect(recordView.recordingLiveBadge()).toBeVisible();

    await recordView.endAndDeleteButton().click();
    await expect(recordView.deleteDialogTitle()).toBeVisible();

    await recordView.keepRecordingButton().click();
    await expect(recordView.deleteDialogTitle()).not.toBeVisible();
    await expect(recordView.recordingLiveBadge()).toBeVisible();

    await recordView.endAndDeleteButton().click();
    await recordView.confirmDeleteButton().click();

    await expect(recordView.newRecordingBadge()).toBeVisible();
    await expect(page.getByText("Back to meetings")).not.toBeVisible();
  });

  test("import via file picker navigates to imported meeting", async ({
    recordView,
    page,
  }) => {
    await recordView.importButton().click();
    // Mock returns picked file "mock-meeting.mp4" → title "mock meeting"
    await expect(page.getByText("Back to meetings")).toBeVisible();
  });

  test("live view shows audio meter, pipeline status, and notes editor", async ({
    recordView,
  }) => {
    await recordView.startRecording("Test");
    await expect(recordView.audioMeterCard()).toBeVisible();
    await expect(recordView.pipelineStatusCard()).toBeVisible();
    await expect(recordView.liveNotesEditor()).toBeVisible();
  });

  test("start button transitions to live view with stop button", async ({
    recordView,
    page,
  }) => {
    await recordView.startButton().click();
    // The mock resolves instantly — verify we transition to live view
    await expect(recordView.recordingLiveBadge()).toBeVisible();
    // End and process button should now be available via the page intro actions
    await expect(
      page.getByRole("button", { name: /End and process/ })
    ).toBeVisible();
  });

  test("home screen shows new recording and import cards", async ({
    recordView,
    page,
  }) => {
    await expect(recordView.newRecordingBadge()).toBeVisible();
    await expect(recordView.importRecordingBadge()).toBeVisible();

    await page.screenshot({
      path: "test-results/screenshots/home-idle.png",
      fullPage: true,
    });
  });
});
