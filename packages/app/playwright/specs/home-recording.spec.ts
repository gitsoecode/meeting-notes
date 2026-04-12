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
    meetingDetail,
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

    await meetingDetail.waitForReady();
  });

  test("end meeting dialog can save without processing", async ({
    recordView,
    page,
    meetingDetail,
  }) => {
    await recordView.startRecording("Saved Meeting");
    await expect(recordView.recordingLiveBadge()).toBeVisible();

    await recordView.endMeetingButton().click();
    await recordView.saveMeetingOption().click();
    await expect(page.getByText("Keep the recording for later.")).toBeVisible();
    await recordView.saveMeetingButton().click();

    await meetingDetail.waitForReady();
    await expect(page.getByText("draft").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Start recording" })).toBeVisible();
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

  test("prepare for later opens a draft with working tabs and files actions", async ({
    recordView,
    page,
  }) => {
    await recordView.prepareForLaterButton().click();
    await expect(page.getByText("draft").first()).toBeVisible();
    await expect(recordView.draftTab("Prep")).toBeVisible();

    await recordView.draftTab("Notes").click();
    await expect(recordView.draftTab("Notes")).toHaveAttribute("data-state", "active");

    await recordView.draftTab("Analysis").click();
    await expect(recordView.draftTab("Analysis")).toHaveAttribute("data-state", "active");

    await recordView.draftTab("Files").click();
    await expect(recordView.draftTab("Files")).toHaveAttribute("data-state", "active");
  });

  test("end meeting dialog cancel keeps recording active", async ({
    recordView,
    page,
  }) => {
    await recordView.startRecording("Keep Going");
    await recordView.endMeetingButton().click();
    await expect(recordView.endMeetingDialogTitle()).toBeVisible();
    await recordView.keepRecordingButton().click();
    await expect(recordView.endMeetingDialogTitle()).not.toBeVisible();
    await expect(recordView.recordingLiveBadge()).toBeVisible();
    await expect(page.getByRole("button", { name: /End meeting/ })).toBeVisible();
  });

  test("recording can pause and resume", async ({
    recordView,
    page,
  }) => {
    await recordView.startRecording("Pause Resume");
    await recordView.pauseButton().click();
    await expect(recordView.resumeButton()).toBeVisible();
    await recordView.resumeButton().click();
    await expect(recordView.pauseButton()).toBeVisible();
    await expect(page.getByRole("button", { name: /End meeting/ })).toBeVisible();
  });

  test("view all meetings button navigates from home", async ({
    recordView,
    page,
  }) => {
    await recordView.viewAllMeetingsButton().click();
    await expect(page.locator("header h1")).toContainText("Meetings");
    await expect(page.getByPlaceholder("Search meetings…")).toBeVisible();
  });

  test("live view shows audio meter, pipeline status, and notes editor", async ({
    recordView,
    page,
  }) => {
    await recordView.startRecording("Test");
    await expect(recordView.audioMeterCard()).toBeVisible();
    await expect(page.getByText("Live notes")).toBeVisible();
    await expect(page.getByText("System audio capturing")).toBeVisible();
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
