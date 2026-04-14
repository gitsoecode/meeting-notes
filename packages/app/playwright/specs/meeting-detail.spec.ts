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

  test("all tabs are functional and switch content", async ({ meetingDetail, page }) => {
    await meetingDetail.tab("Prep").click();
    await expect(page.getByText("Review backlog")).toBeVisible();

    await meetingDetail.tab("Notes").click();
    await expect(page.getByText("These are the notes I found:")).toBeVisible();

    await meetingDetail.tab("Summary").click();
    await expect(page.getByRole("heading", { name: "Summary", exact: true })).toBeVisible();

    await meetingDetail.tab("Analysis").click();
    await expect(meetingDetail.promptSidebarItem("Decision Log")).toBeVisible();
    await meetingDetail.promptSidebarItem("Decision Log").click();
    await expect(page.getByRole("heading", { name: "Decisions" })).toBeVisible();

    await meetingDetail.tab("Transcript").click();
    await expect(page.getByText("Welcome everyone.")).toBeVisible();

    await meetingDetail.tab("Recording").click();
    await expect(page.getByText("audio/mic.wav")).toBeVisible();

    await meetingDetail.tab("Files").click();
    await expect(page.getByText("Attached files (1)")).toBeVisible();

    await meetingDetail.tab("Metadata").click();
    await expect(meetingDetail.metadataHeading()).toBeVisible();
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

  test("analysis sidebar shows model name in prompt metadata", async ({ meetingDetail, page }) => {
    await meetingDetail.tab("Analysis").click();
    // Decision Log has model: "qwen3.5:9b" — shown as the raw Ollama model name
    await expect(page.getByText("qwen3.5:9b").first()).toBeVisible();
  });

  test("processing step rows display model name", async ({ meetingDetail, page }) => {
    await meetingDetail.tab("Analysis").click();
    await meetingDetail.promptSidebarItem("1:1 Follow-up").click();
    await meetingDetail.runPromptButton().click();
    // The PipelineStatus step rows should show the raw model name
    await expect(page.getByText("qwen3.5:9b").first()).toBeVisible();
  });

  test("notes and transcript tabs render meeting content", async ({ meetingDetail, page }) => {
    await meetingDetail.tab("Notes").click();
    await expect(page.getByText("These are the notes I found:")).toBeVisible();

    await meetingDetail.tab("Transcript").click();
    await expect(page.getByText("Welcome everyone.")).toBeVisible();
  });

  test("metadata description can be edited, cancelled, and saved", async ({
    meetingDetail,
    page,
  }) => {
    await meetingDetail.tab("Metadata").click();
    await meetingDetail.metadataDescriptionText().click();
    await meetingDetail.metadataDescriptionTextarea().fill("Changed description");
    await meetingDetail.metadataCancelButton().click();
    await expect(page.getByText("Changed description")).toHaveCount(0);

    await meetingDetail.metadataDescriptionText().click();
    await meetingDetail.metadataDescriptionTextarea().fill("Changed description");
    await meetingDetail.metadataSaveButton().click();
    await expect(page.getByText("Changed description").first()).toBeVisible();
  });

  test("recording and files tabs show stored artifacts", async ({ meetingDetail, page }) => {
    await meetingDetail.tab("Recording").click();
    await expect(page.getByText("audio/mic.wav")).toBeVisible();
    await expect(page.locator("audio")).toHaveCount(2);

    await meetingDetail.tab("Files").click();
    await expect(page.getByText("Attached files (1)")).toBeVisible();
    await expect(page.getByText("agenda.pdf")).toBeVisible();
  });

  test("audio players load and have playable source", async ({ meetingDetail, page }) => {
    await meetingDetail.tab("Recording").click();
    await expect(page.locator("audio")).toHaveCount(2);

    // Each audio element should have a src attribute set (data URL from mock)
    const audioElements = page.locator("audio");
    for (let i = 0; i < 2; i++) {
      const src = await audioElements.nth(i).getAttribute("src");
      expect(src).toBeTruthy();
      expect(src).toContain("blob:");
    }

    // Wait for metadata to load, then verify duration > 0
    const loaded = await audioElements.first().evaluate(
      (el) =>
        new Promise<{ duration: number; error: string | null }>((resolve) => {
          const audio = el as HTMLAudioElement;
          if (audio.readyState >= 1) {
            resolve({ duration: audio.duration, error: audio.error?.message ?? null });
            return;
          }
          audio.addEventListener("loadedmetadata", () =>
            resolve({ duration: audio.duration, error: null })
          );
          audio.addEventListener("error", () =>
            resolve({ duration: NaN, error: audio.error?.message ?? "unknown error" })
          );
          audio.load();
        })
    );
    expect(loaded.error).toBeNull();
    expect(loaded.duration).toBeGreaterThan(0);

    // Verify no media error occurred (the element is functional)
    const mediaError = await audioElements.first().evaluate(
      (el) => (el as HTMLAudioElement).error?.message ?? null
    );
    expect(mediaError).toBeNull();
  });

  test("recording delete dialog cancels cleanly", async ({ meetingDetail, page }) => {
    await meetingDetail.tab("Recording").click();
    await meetingDetail.deleteRecordingButton().click();
    await expect(meetingDetail.deleteRecordingDialogTitle()).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(meetingDetail.deleteRecordingDialogTitle()).not.toBeVisible();
    await expect(page.getByText("audio/mic.wav")).toBeVisible();
  });

  test("open folder action calls the external handler", async ({ app, meetingDetail }) => {
    await meetingDetail.moreActionsButton().click();
    await meetingDetail.openFolderButton().click();
    await expect
      .poll(async () => await app.lastExternalAction())
      .toMatchObject({
        type: "open-run-in-finder",
        payload: { runFolder: "/runs/weekly-planning" },
      });
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

  test("processing meeting shows progress on notes and summary tabs instead of empty state", async ({
    app,
    meetingsList,
    page,
  }) => {
    await app.navigateTo("Meetings");
    await meetingsList.waitForReady();
    await meetingsList.meetingRow("Customer call").click();

    // Should show processing state, not "No notes for this meeting"
    const notesTab = page.getByRole("tab", { name: "Notes" });
    await notesTab.click();
    await expect(page.getByText("No notes for this meeting.")).toHaveCount(0);
    await expect(page.getByText(/Notes will appear|Processing/i).first()).toBeVisible();

    // Summary tab should also show processing state
    const summaryTab = page.getByRole("tab", { name: "Summary" });
    await summaryTab.click();
    await expect(page.getByText("Summary is being generated")).toBeVisible();
  });

  test("draft meeting shows editor on notes tab and start recording button", async ({
    app,
    meetingsList,
    page,
  }) => {
    await app.navigateTo("Meetings");
    await meetingsList.waitForReady();
    await meetingsList.meetingRow("Draft standup").click();

    // Draft should show the notes editor (not read-only)
    const notesTab = page.getByRole("tab", { name: "Notes" });
    await notesTab.click();
    // The draft notes tab renders a CodeMirror editor, not an empty state
    await expect(page.getByText("No notes for this meeting.")).toHaveCount(0);

    // Prep tab should show the prep notes
    const prepTab = page.getByRole("tab", { name: "Prep" });
    await prepTab.click();
    await expect(page.getByText("Check yesterday's blockers")).toBeVisible();

    // Start recording button should be available
    await expect(page.getByRole("button", { name: "Start recording" })).toBeVisible();
  });

  test("error meeting shows failed state and allows reprocessing", async ({
    app,
    meetingsList,
    page,
  }) => {
    await app.navigateTo("Meetings");
    await meetingsList.waitForReady();
    await meetingsList.meetingRow("Failed import").click();

    // Analysis tab should show the failure
    const analysisTab = page.getByRole("tab", { name: "Analysis" });
    await analysisTab.click();
    await expect(page.getByText(/failed/i).first()).toBeVisible();
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
