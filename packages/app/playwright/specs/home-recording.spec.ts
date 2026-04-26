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
    meetingWorkspace,
  }) => {
    await page.evaluate(() => {
      (window as unknown as {
        __MEETING_NOTES_TEST: { setProgressEmissionDelay: (ms: number) => void };
      }).__MEETING_NOTES_TEST.setProgressEmissionDelay(3000);
    });

    await recordView.startRecording("Test Meeting");
    await expect(recordView.recordingLiveBadge()).toBeVisible();

    await recordView.endMeetingButton().click();
    await expect(recordView.endMeetingDialogTitle()).toBeVisible();
    await expect(page.getByRole("radio", { name: /Process meeting/ })).toBeChecked();
    await expect(recordView.transcribeCheckbox()).toBeChecked();
    await expect(page.getByText("Uses local model qwen3.5:9b")).toBeVisible();
    await expect(page.getByText("Uses Sonnet 4.6")).toBeVisible();
    await recordView.confirmEndMeetingButton().click();

    // After the save/process roundtrip, the meeting route first sees the run
    // as a draft (the mock transitions status draft → processing → complete).
    // The default-view resolver therefore picks Workspace; the meeting page
    // still loads, which is what this test cares about. A follow-up test
    // covers the post-completion Details landing.
    await meetingWorkspace.waitForReady({ view: "workspace" });
    await expect(meetingWorkspace.statusChip()).toContainText("Processing");
    await expect(meetingWorkspace.statusChip()).not.toContainText("Complete");
  });

  test("end meeting dialog can save without processing", async ({
    recordView,
    page,
    meetingWorkspace,
  }) => {
    await recordView.startRecording("Saved Meeting");
    await expect(recordView.recordingLiveBadge()).toBeVisible();

    await recordView.endMeetingButton().click();
    await recordView.saveMeetingOption().click();
    await expect(page.getByText("Keep the recording for later.")).toBeVisible();
    await recordView.saveMeetingButton().click();

    // Save-without-processing leaves the meeting as a draft, which lands on
    // the Workspace view by default.
    await meetingWorkspace.waitForReady({ view: "workspace" });
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

    // After Stage 4, quick-start creates a draft first and lands the user in
    // the meeting shell; end-meeting → delete calls the shell's `onBack` which
    // navigates to the Meetings list (not Home).
    await expect(page.locator("header h1")).toContainText("Meetings");
    // Meeting-shell controls (Workspace/Details toggle) should not be present
    // on the Meetings list route.
    await expect(page.getByRole("tab", { name: "Workspace" })).not.toBeVisible();
  });

  test("import via file picker navigates to imported meeting", async ({
    recordView,
    page,
  }) => {
    await recordView.importButton().click();
    // Mock returns picked file "mock-meeting.mp4" → title "mock meeting".
    // The meeting route is the only place the Workspace|Details toggle
    // renders, so use it as the "on a meeting page" signal.
    await expect(page.getByRole("tab", { name: "Workspace" })).toBeVisible();
  });

  test("prepare for later opens a draft in the Workspace split pane", async ({
    recordView,
    meetingWorkspace,
    page,
  }) => {
    await recordView.prepareForLaterButton().click();
    await meetingWorkspace.waitForReady({ view: "workspace" });
    await expect(page.getByText("draft").first()).toBeVisible();
    // Draft defaults to Workspace view with the Prep + Notes split pane.
    await expect(meetingWorkspace.workspacePanelGroup()).toBeVisible();
    await expect(page.getByRole("button", { name: "Start recording" })).toBeVisible();
    // Toggling to Details exposes the tab set; Analysis and Files live there.
    await meetingWorkspace.viewToggle("Details").click();
    await expect(meetingWorkspace.tab("Analysis")).toBeVisible();
    await meetingWorkspace.tab("Files").click();
    await expect(meetingWorkspace.tab("Files")).toHaveAttribute("data-state", "active");
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
