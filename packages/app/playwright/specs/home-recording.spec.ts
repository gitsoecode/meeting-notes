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

  test("end meeting dialog can process and navigate to the meeting workspace", async ({
    recordView,
    page,
  }) => {
    await recordView.startRecording("Test Meeting");
    await expect(recordView.recordingLiveBadge()).toBeVisible();

    await recordView.endMeetingButton().click();
    await expect(recordView.endMeetingDialogTitle()).toBeVisible();
    await expect(page.getByRole("radio", { name: /Process meeting/ })).toBeChecked();
    await expect(recordView.transcribeCheckbox()).toBeChecked();
    await expect(page.getByText("Uses local model qwen3.5:9b")).toBeVisible();
    await expect(page.getByText("Uses Sonnet 4.6")).toBeVisible();
    await recordView.confirmEndMeetingButton().click();

    // Should navigate to meeting detail
    await expect(page.getByText("Back to meetings")).toBeVisible();
  });

  test("end meeting dialog can save without processing", async ({
    recordView,
    page,
  }) => {
    await recordView.startRecording("Saved Meeting");
    await expect(recordView.recordingLiveBadge()).toBeVisible();

    await recordView.endMeetingButton().click();
    await recordView.saveMeetingOption().click();
    await expect(page.getByText("run processing later")).toBeVisible();
    await recordView.saveMeetingButton().click();

    await expect(page.getByText("Back to meetings")).toBeVisible();
    await expect(page.getByText("No summary has been generated for this meeting yet.")).toBeVisible();
  });

  test("end and delete confirms before discarding the live meeting", async ({
    recordView,
    page,
  }) => {
    await recordView.startRecording("Throwaway Meeting");
    await expect(recordView.recordingLiveBadge()).toBeVisible();

    await recordView.endMeetingButton().click();
    await recordView.deleteMeetingOption().click();
    await recordView.reviewDeleteButton().click();
    await expect(recordView.deleteDialogTitle()).toBeVisible();

    await page.getByRole("button", { name: "Keep meeting" }).click();
    await expect(recordView.deleteDialogTitle()).not.toBeVisible();
    await expect(recordView.recordingLiveBadge()).toBeVisible();

    await recordView.endMeetingButton().click();
    await recordView.deleteMeetingOption().click();
    await recordView.reviewDeleteButton().click();
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
    await expect(page.getByRole("button", { name: /End meeting/ })).toBeVisible();
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
