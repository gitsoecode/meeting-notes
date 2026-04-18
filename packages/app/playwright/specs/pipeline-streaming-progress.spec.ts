import { test, expect } from "../fixtures/base.fixture";

// Regression test for the "0 output tokens for 23s" silent-failure UX. When
// Claude or OpenAI streams deltas, the engine's onTokenProgress callback
// must flow all the way through IPC and make the PipelineStatus step row
// re-render with the running token count. If that chain breaks, the user
// sees a frozen "0 output tokens" the entire duration, as reported in the
// bug that drove the adapter streaming rewrite.
//
// Mechanics: the mock's startReprocess handler normally fires only
// output-start and output-complete. With setProgressEmissionDelay(ms) > 0
// it additionally emits a chain of three output-progress events with
// tokensGenerated = 3, 8, 14 spaced by the given delay, mirroring what
// a live Claude/OpenAI streaming call looks like.
test.describe("Analysis prompt streaming progress", () => {
  test.beforeEach(async ({ app, meetingsList, meetingWorkspace, page }) => {
    await app.navigateTo("Meetings");
    await meetingsList.waitForReady();
    await meetingsList.meetingRow("Weekly planning").click();
    await meetingWorkspace.waitForReady({ view: "details" });
    // 150ms between progress ticks — long enough for React to commit a
    // render between each event, short enough to keep the test well under
    // the 8s spec budget.
    await page.evaluate(() => {
      (window as unknown as {
        __MEETING_NOTES_TEST: { setProgressEmissionDelay: (ms: number) => void };
      }).__MEETING_NOTES_TEST.setProgressEmissionDelay(150);
    });
  });

  test("live token count ticks up while a prompt is running", async ({
    meetingWorkspace,
    page,
  }) => {
    await meetingWorkspace.tab("Analysis").click();
    // Pick a prompt that has no existing output for this run so the
    // pipeline goes start → progress → complete instead of a no-op.
    await meetingWorkspace.promptSidebarItem("1:1 Follow-up").click();
    await expect(
      page.getByText("This prompt has not produced output for this meeting yet.")
    ).toBeVisible();

    await meetingWorkspace.runPromptButton().click();

    // The PipelineStatus card renders a step row for each running output.
    // While state === "running", the row shows "{N} output tokens".
    // As streaming deltas arrive, the count must move off of 0.
    await expect(page.getByText("0 output tokens")).toBeVisible();

    // At least one of the synthetic mid-stream tick values should land
    // in a visible render before the step transitions to "complete".
    await expect(page.getByText(/\b(3|8|14) output tokens\b/)).toBeVisible();

    // After output-complete fires, the analysis panel should show the
    // generated output for the selected prompt.
    await expect(
      page.getByRole("heading", { name: "Follow-up", exact: true })
    ).toBeVisible();
  });
});
