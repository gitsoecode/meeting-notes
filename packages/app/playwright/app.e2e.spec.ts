import { test, expect } from "./fixtures/base.fixture";

test("runs through home, recording, meeting workspace, and prompt workflows", async ({
  app,
  recordView,
  meetingWorkspace,
  promptsEditor,
  page,
}) => {
  await recordView.waitForHomeReady();

  await app.emitAppAction("open-new-meeting", "tray");
  await expect(page.getByRole("heading", { name: "New meeting" })).toBeVisible();

  await recordView.startRecording("Cross-team sync");
  await expect(recordView.recordingLiveBadge()).toBeVisible();

  await recordView.endMeetingButton().click();
  await expect(recordView.endMeetingDialogTitle()).toBeVisible();
  await recordView.confirmEndMeetingButton().click();

  // End-recording-from-home landing first resolves to Workspace during the
  // transient draft state. Flip to Details explicitly.
  await meetingWorkspace.waitForReady({ view: "workspace" });
  await meetingWorkspace.viewToggle("Details").click();
  await meetingWorkspace.tab("Summary").click();
  await expect(meetingWorkspace.tab("Summary")).toHaveAttribute("data-state", "active");

  await meetingWorkspace.tab("Transcript").click();
  await expect(page.getByText("Welcome everyone.")).toBeVisible();

  await meetingWorkspace.tab("Analysis").click();
  await meetingWorkspace.promptSidebarItem("Decision Log").click();
  await meetingWorkspace.runPromptButton().click();
  await expect(page.getByRole("heading", { name: "Decision Log" })).toBeVisible();

  await meetingWorkspace.tab("Metadata").click();
  await expect(meetingWorkspace.metadataHeading()).toBeVisible();

  await app.navigateTo("Prompt Library");
  await expect(promptsEditor.titleInput()).toBeVisible();
  await promptsEditor.promptSidebarItem("Decision Log").click();
  await promptsEditor.activeAutoRunSwitch().click();
  await expect(promptsEditor.activeAutoRunSwitch()).toHaveAttribute("aria-checked", "true");
  await promptsEditor.moreButton().click();
  await promptsEditor.runAgainstMeetingItem().click();
  await expect(promptsEditor.runAgainstModalHeading()).toBeVisible();
  await promptsEditor.runAgainstModalCancel().click();
  await promptsEditor.newPromptButton().click();
  await expect(promptsEditor.newPromptDialog()).toBeVisible();
  await promptsEditor.newPromptIdInput().fill("follow-up-email");
  await promptsEditor.newPromptLabelInput().fill("Follow-up email");
  await promptsEditor.newPromptFilenameInput().fill("follow-up-email.md");
  await promptsEditor.createPromptButton().click();
  await expect(page.getByText("Follow-up email")).toBeVisible();
});

test("covers meetings list, import, bulk actions, and activity states", async ({
  app,
  meetingsList,
  meetingWorkspace,
  page,
}) => {
  await app.navigateTo("Meetings");
  await meetingsList.waitForReady();

  await meetingsList.searchInput().fill("customer");
  await expect(meetingsList.meetingRow("Customer call")).toBeVisible();
  await meetingsList.searchInput().fill("");

  await meetingsList.meetingCheckbox("Customer call").click();
  await meetingsList.bulkRunButton().click();
  await expect(meetingsList.bulkRunModalHeading()).toBeVisible();
  await meetingsList.bulkRunModalRunButton().click();
  await expect(meetingsList.bulkRunModalDoneButton()).toBeVisible();
  await meetingsList.bulkRunModalDoneButton().click();

  await meetingsList.meetingRow("Customer call").click();
  await meetingWorkspace.waitForReady({ view: "details" });
  await expect(page.getByText("Processing").first()).toBeVisible();

  await app.navigateTo("Activity");
  await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
  await expect(page.getByText("Processing imported media").first()).toBeVisible();
});
