import { test, expect } from "../fixtures/base.fixture";

test.describe("Meeting Workspace", () => {
  test.beforeEach(async ({ app, meetingsList, meetingWorkspace }) => {
    await app.navigateTo("Meetings");
    await meetingsList.waitForReady();
    await meetingsList.meetingRow("Weekly planning").click();
    // Completed meetings default to the Details view.
    await meetingWorkspace.waitForReady({ view: "details" });
  });

  test("loads the workspace with the current tab set", async ({ meetingWorkspace }) => {
    // Summary is the default landing tab; Metadata moved to last.
    await expect(meetingWorkspace.tab("Summary")).toHaveAttribute("data-state", "active");
    await expect(meetingWorkspace.tab("Metadata")).toBeVisible();
    await expect(meetingWorkspace.tab("Analysis")).toBeVisible();
    await expect(meetingWorkspace.tab("Transcript")).toBeVisible();
    await expect(meetingWorkspace.tab("Recording")).toBeVisible();
    await expect(meetingWorkspace.tab("Files")).toBeVisible();
    // Pin the visible tab order. Files label is dynamic ("Files" or
    // "Files (N)") when attachments exist; normalize before comparing.
    const labels = await meetingWorkspace
      .tabsList()
      .getByRole("tab")
      .allInnerTexts();
    expect(labels.map((t) => t.replace(/\s*\(\d+\)$/, "").trim())).toEqual([
      "Summary",
      "Analysis",
      "Transcript",
      "Recording",
      "Files",
      "Metadata",
    ]);
    // Prep and Notes tabs were removed from Details — prep/notes editing lives
    // in the Workspace view now.
    await expect(meetingWorkspace.tab("Prep" as never)).toHaveCount(0);
    await expect(meetingWorkspace.tab("Notes" as never)).toHaveCount(0);
    // The Workspace/Details segmented toggle is visible above the tabs.
    await expect(meetingWorkspace.viewToggle("Workspace")).toBeVisible();
    await expect(meetingWorkspace.viewToggle("Details")).toBeVisible();
  });

  test("all tabs are functional and switch content", async ({ meetingWorkspace, page }) => {
    await meetingWorkspace.tab("Summary").click();
    await expect(page.getByRole("heading", { name: "Summary", exact: true })).toBeVisible();
    await expect(page.getByText("Highlights")).toBeVisible();
    // Frontmatter must not leak into the rendered editor
    await expect(page.getByText("source: mock")).toHaveCount(0);

    await meetingWorkspace.tab("Analysis").click();
    await expect(meetingWorkspace.promptSidebarItem("Decision Log")).toBeVisible();
    await meetingWorkspace.promptSidebarItem("Decision Log").click();
    await expect(page.getByRole("heading", { name: "Decisions" })).toBeVisible();

    await meetingWorkspace.tab("Transcript").click();
    await expect(page.getByText("Welcome everyone.")).toBeVisible();

    await meetingWorkspace.tab("Recording").click();
    await expect(page.getByText("audio/combined.wav")).toBeVisible();

    await meetingWorkspace.tab("Files").click();
    await expect(page.getByText("Attached files (1)")).toBeVisible();

    await meetingWorkspace.tab("Metadata").click();
    await expect(meetingWorkspace.metadataHeading()).toBeVisible();
  });

  test("toggling to Workspace view shows the Prep + Notes split pane with loaded content", async ({ meetingWorkspace, page }) => {
    await meetingWorkspace.viewToggle("Workspace").click();
    // Resize panel group renders
    await expect(meetingWorkspace.workspacePanelGroup()).toBeVisible();
    // Prep pane content from readPrep is visible (the "# Prep" heading is
    // unique to the Prep pane for the weekly-planning mock).
    await expect(page.getByRole("heading", { name: "Prep", level: 1 })).toBeVisible();
    // Notes pane content from notes.md is visible
    await expect(page.getByText("These are the notes I found:")).toBeVisible();
  });

// TODO(workspace-details-split): the in-place "Refresh" button on the Summary
  // tab no longer exists — refreshing a summary now goes through the Reprocess
  // dropdown + modal. Rewrite this test against that flow in a follow-up.
  test.skip("summary tab shows output and can refresh", async ({ meetingWorkspace, page }) => {
    await meetingWorkspace.tab("Summary").click();
    await expect(page.getByText("Highlights")).toBeVisible();
    await meetingWorkspace.refreshSummaryButton().click();
    await expect(page.getByText("Clarified pricing next steps.")).toBeVisible();
  });

  test("analysis tab shows existing and missing outputs", async ({ meetingWorkspace, page }) => {
    await meetingWorkspace.tab("Analysis").click();
    await meetingWorkspace.promptSidebarItem("Decision Log").click();
    await expect(page.getByRole("heading", { name: "Decisions" })).toBeVisible();

    await meetingWorkspace.promptSidebarItem("1:1 Follow-up").click();
    await expect(page.getByText("This prompt has not produced output for this meeting yet.")).toBeVisible();
    await meetingWorkspace.runPromptButton().click();
    await expect(page.getByRole("heading", { name: "Follow-up", exact: true })).toBeVisible();
  });

  test("analysis sidebar shows model name in prompt metadata", async ({ meetingWorkspace, page }) => {
    await meetingWorkspace.tab("Analysis").click();
    // Decision Log has model: "qwen3.5:9b" — shown as the raw Ollama model name
    await expect(page.getByText("qwen3.5:9b").first()).toBeVisible();
  });

  test("processing step rows display model name", async ({ meetingWorkspace, page }) => {
    await meetingWorkspace.tab("Analysis").click();
    await meetingWorkspace.promptSidebarItem("1:1 Follow-up").click();
    await meetingWorkspace.runPromptButton().click();
    // The PipelineStatus step rows should show the raw model name
    await expect(page.getByText("qwen3.5:9b").first()).toBeVisible();
  });

  test("transcript tab renders meeting content", async ({ meetingWorkspace, page }) => {
    await meetingWorkspace.tab("Transcript").click();
    await expect(page.getByText("Welcome everyone.")).toBeVisible();
  });

  test("transcript groups consecutive same-speaker utterances under one header", async ({
    meetingWorkspace,
    page,
  }) => {
    await meetingWorkspace.tab("Transcript").click();
    // Scope every assertion to the transcript tabpanel so generic strings like
    // "Me" / "ME" don't collide with other UI on the page.
    const panel = page
      .getByRole("tabpanel")
      .filter({ hasText: "Welcome everyone." });

    // All utterance text is preserved.
    for (const line of [
      "Welcome everyone.",
      "We need to lock the sprint scope.",
      "Quick agenda check before we dive in.",
      "Let's keep the reporting task in.",
      "Sounds good to me.",
      "And one more thing — I almost forgot the OKRs.",
      "Let's revisit those next week.",
    ]) {
      await expect(panel.getByText(line)).toBeVisible();
    }

    // Fixture has Me → Others → Me. Headers should collapse to:
    //   2 "Me" headers (consecutive Me utterances within a group share one),
    //   1 "Others" header.
    await expect(panel.getByText("Me", { exact: true })).toHaveCount(2);
    await expect(panel.getByText("Others", { exact: true })).toHaveCount(1);

    // Avatar fallback initials render exactly once per group header.
    await expect(panel.getByText("ME", { exact: true })).toHaveCount(2);
    await expect(panel.getByText("O", { exact: true })).toHaveCount(1);

    // Every timestamped line now renders its own clickable timestamp pill.
    // `getByRole('button', { name: /Play from 00:15/ })` locates the line
    // whose timestamp is 00:15 — the whole row is the tap target.
    for (const ts of ["00:00", "00:15", "00:22", "00:32", "00:45", "01:05"]) {
      await expect(
        panel.getByRole("button", { name: new RegExp(`Play from ${ts}`) }),
      ).toBeVisible();
    }

    // Bare line (no `MM:SS` prefix) still renders; it's not clickable, so
    // no "Play from" button points at it.
    await expect(
      panel.getByText("And one more thing — I almost forgot the OKRs."),
    ).toBeVisible();
  });

  test("metadata description can be edited, cancelled, and saved", async ({
    meetingWorkspace,
    page,
  }) => {
    await meetingWorkspace.tab("Metadata").click();
    await meetingWorkspace.metadataDescriptionText().click();
    await meetingWorkspace.metadataDescriptionTextarea().fill("Changed description");
    await meetingWorkspace.metadataCancelButton().click();
    await expect(page.getByText("Changed description")).toHaveCount(0);

    await meetingWorkspace.metadataDescriptionText().click();
    await meetingWorkspace.metadataDescriptionTextarea().fill("Changed description");
    await meetingWorkspace.metadataSaveButton().click();
    await expect(page.getByText("Changed description").first()).toBeVisible();
  });

  test("recording and files tabs show stored artifacts", async ({ meetingWorkspace, page }) => {
    await meetingWorkspace.tab("Recording").click();
    // combined.wav is pinned at the top; mic/system/etc. live behind a
    // collapsed "Source files" accordion.
    await expect(page.getByText("audio/combined.wav")).toBeVisible();
    await expect(page.getByText("audio/mic.wav")).toBeHidden();
    await meetingWorkspace.expandSourceFiles();
    await expect(page.getByText("audio/mic.wav")).toBeVisible();
    // mic.wav and system.wav each render a native <audio>; combined.wav
    // hosts the shared unified-player audio via React Portal → 3 total.
    await expect(page.locator("audio")).toHaveCount(3);

    await meetingWorkspace.tab("Files").click();
    await expect(page.getByText("Attached files (1)")).toBeVisible();
    await expect(page.getByText("agenda.pdf")).toBeVisible();
  });

  test("audio players load and have playable source", async ({ meetingWorkspace, page }) => {
    await meetingWorkspace.tab("Recording").click();
    await meetingWorkspace.expandSourceFiles();
    await expect(page.locator("audio")).toHaveCount(3);

    // All three recording-tab <audio> elements should have a blob URL.
    const recordingAudios = page
      .getByRole("tabpanel", { name: "Recording" })
      .locator("audio");
    await expect(recordingAudios).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      const src = await recordingAudios.nth(i).getAttribute("src");
      expect(src).toBeTruthy();
      expect(src).toContain("blob:");
    }

    // Wait for metadata to load, then verify duration > 0
    const loaded = await recordingAudios.first().evaluate(
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
    const mediaError = await recordingAudios.first().evaluate(
      (el) => (el as HTMLAudioElement).error?.message ?? null
    );
    expect(mediaError).toBeNull();
  });

  test("recording delete dialog cancels cleanly", async ({ meetingWorkspace, page }) => {
    await meetingWorkspace.tab("Recording").click();
    await meetingWorkspace.deleteRecordingButton().click();
    await expect(meetingWorkspace.deleteRecordingDialogTitle()).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(meetingWorkspace.deleteRecordingDialogTitle()).not.toBeVisible();
    await expect(page.getByText("audio/combined.wav")).toBeVisible();
  });

  test("open folder action calls the external handler", async ({ app, meetingWorkspace }) => {
    await meetingWorkspace.moreActionsButton().click();
    await meetingWorkspace.openFolderButton().click();
    await expect
      .poll(async () => await app.lastExternalAction())
      .toMatchObject({
        type: "open-run-in-finder",
        payload: { runFolder: "/runs/weekly-planning" },
      });
  });

  test("can reopen a complete meeting as a draft and continue recording", async ({
    meetingWorkspace,
    page,
  }) => {
    await meetingWorkspace.moreActionsButton().click();
    await meetingWorkspace.editAsDraftItem().click();
    await expect(page.getByText("draft").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Start recording" })).toBeVisible();
    await page.getByRole("button", { name: "Start recording" }).click();
    await expect(page.getByRole("button", { name: "End meeting" })).toBeVisible();
  });

  test("processing meeting shows progress on summary tab instead of empty state", async ({
    app,
    meetingsList,
    meetingWorkspace,
    page,
  }) => {
    await app.navigateTo("Meetings");
    await meetingsList.waitForReady();
    await meetingsList.meetingRow("Customer call").click();
    await meetingWorkspace.waitForReady({ view: "details" });

    // Summary tab should show processing state, not "No notes for this meeting"
    await meetingWorkspace.tab("Summary").click();
    await expect(page.getByText("Summary is being generated")).toBeVisible();
  });

  test("draft meeting lands in Workspace view with the split pane + start recording", async ({
    app,
    meetingsList,
    meetingWorkspace,
    page,
  }) => {
    await app.navigateTo("Meetings");
    await meetingsList.waitForReady();
    await meetingsList.meetingRow("Draft standup").click();
    // Drafts default to the Workspace view.
    await meetingWorkspace.waitForReady({ view: "workspace" });

    await expect(meetingWorkspace.workspacePanelGroup()).toBeVisible();
    // Prep content from mocks is visible in the split pane
    await expect(page.getByText("Check yesterday's blockers")).toBeVisible();
    // Start recording button should be available
    await expect(page.getByRole("button", { name: "Start recording" })).toBeVisible();
  });

  test("error meeting shows failed state and allows reprocessing", async ({
    app,
    meetingsList,
    meetingWorkspace,
    page,
  }) => {
    await app.navigateTo("Meetings");
    await meetingsList.waitForReady();
    await meetingsList.meetingRow("Failed import").click();
    await meetingWorkspace.waitForReady({ view: "details" });

    // Analysis tab should show the failure
    await meetingWorkspace.tab("Analysis").click();
    await expect(page.getByText(/failed/i).first()).toBeVisible();
  });

  test("delete cancels and confirms cleanly", async ({ meetingWorkspace, page }) => {
    await meetingWorkspace.moreActionsButton().click();
    await meetingWorkspace.deleteButton().click();
    await page.getByRole("button", { name: "Keep meeting" }).click();
    await expect(meetingWorkspace.tab("Metadata")).toBeVisible();

    await meetingWorkspace.moreActionsButton().click();
    await meetingWorkspace.deleteButton().click();
    await page.getByRole("button", { name: "Delete meeting" }).click();
    await expect(page.locator("header h1")).toContainText("Meetings");
  });
});
