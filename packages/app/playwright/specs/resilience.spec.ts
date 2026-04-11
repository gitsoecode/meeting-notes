import { test, expect } from "../fixtures/base.fixture";

const WEEKLY_RUN = "/runs/weekly-planning";

test.describe("Resilience", () => {
  test("stale meetings are pruned from the list and fail gracefully from detail navigation", async ({
    app,
    meetingsList,
    meetingDetail,
    page,
  }) => {
    await app.navigateTo("Meetings");
    await meetingsList.waitForReady();
    await expect(meetingsList.meetingRow("Weekly planning")).toBeVisible();

    await app.removeRunFolder(WEEKLY_RUN);
    await meetingsList.meetingRow("Weekly planning").click();
    await expect(meetingDetail.friendlyError()).toBeVisible();

    await app.navigateTo("Meetings");
    await meetingsList.waitForReady();
    await expect(page.getByText("Weekly planning")).toHaveCount(0);
  });

  test("missing attachments directory renders an empty files state without crashing", async ({
    app,
    meetingsList,
    meetingDetail,
    page,
  }) => {
    await app.removeAttachmentDirectory(WEEKLY_RUN);
    await app.navigateTo("Meetings");
    await meetingsList.waitForReady();
    await meetingsList.meetingRow("Weekly planning").click();
    await meetingDetail.waitForReady();
    await meetingDetail.tab("Files").click();
    await expect(page.getByText("Drop files here or click to browse")).toBeVisible();
    await expect(page.getByText("agenda.pdf")).toHaveCount(0);
  });

  test("missing transcript file keeps the workspace mounted and shows an empty-state message", async ({
    app,
    meetingsList,
    meetingDetail,
    page,
  }) => {
    await app.removeDocument(WEEKLY_RUN, "transcript.md");
    await app.navigateTo("Meetings");
    await meetingsList.waitForReady();
    await meetingsList.meetingRow("Weekly planning").click();
    await meetingDetail.waitForReady();
    await meetingDetail.tab("Transcript").click();
    await expect(page.getByText("No transcript available for this meeting.")).toBeVisible();
    await expect(meetingDetail.tab("Summary")).toBeVisible();
  });

  test("failed prompt outputs surface as failed pipeline state and preserve the workspace", async ({
    app,
    meetingsList,
    meetingDetail,
    page,
  }) => {
    await app.failPromptOutput(WEEKLY_RUN, "one-on-one-follow-up", "Mock prompt failure");
    await app.navigateTo("Meetings");
    await meetingsList.waitForReady();
    await meetingsList.meetingRow("Weekly planning").click();
    await meetingDetail.waitForReady();
    await meetingDetail.tab("Analysis").click();
    await meetingDetail.promptSidebarItem("1:1 Follow-up").click();
    await meetingDetail.runPromptButton().click();
    await expect(page.getByText("1 failed")).toBeVisible();
    await expect(page.getByText("This prompt has not produced output for this meeting yet.")).toBeVisible();
  });
});
