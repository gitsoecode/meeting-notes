import { test, expect } from "../fixtures/base.fixture";

test.describe("Meetings List", () => {
  test.beforeEach(async ({ app }) => {
    await app.navigateTo("Meetings");
  });

  test("loads with meetings and shows heading", async ({ meetingsList }) => {
    await expect(meetingsList.heading()).toBeVisible();
    await expect(meetingsList.meetingRow("Weekly planning")).toBeVisible();
    await expect(meetingsList.meetingRow("Customer call")).toBeVisible();
  });

  test("search filters meetings", async ({ meetingsList }) => {
    await meetingsList.searchInput().fill("customer");
    await expect(meetingsList.meetingRow("Customer call")).toBeVisible();
    await expect(meetingsList.meetingRow("Weekly planning")).not.toBeVisible();

    await meetingsList.searchInput().clear();
    await expect(meetingsList.meetingRow("Weekly planning")).toBeVisible();
  });

  test("checkbox selection shows bulk run button", async ({
    meetingsList,
    page,
  }) => {
    await meetingsList.meetingCheckbox("Customer call").click();
    await expect(meetingsList.bulkRunButton()).toBeVisible();

    await page.screenshot({
      path: "test-results/screenshots/meetings-list-bulk-selected.png",
      fullPage: true,
    });
  });

  test("select all toggles visible meetings and shows both bulk actions", async ({
    meetingsList,
  }) => {
    await meetingsList.selectAllCheckbox().click();
    await expect(meetingsList.bulkRunButton()).toBeVisible();
    await expect(meetingsList.bulkDeleteButton()).toBeVisible();
  });

  test("bulk run modal flow: select prompt, run, done", async ({
    meetingsList,
  }) => {
    await meetingsList.meetingCheckbox("Customer call").click();
    await meetingsList.bulkRunButton().click();

    await expect(meetingsList.bulkRunModalHeading()).toBeVisible();
    await expect(meetingsList.bulkRunPromptSummary()).toContainText("Summary + Action Items");
    await expect(meetingsList.bulkRunPromptSummary()).toContainText("qwen3.5:9b");
    await expect(meetingsList.bulkRunPromptSummary()).toContainText(
      "Default meeting prompt for most meetings."
    );
    await meetingsList.bulkRunModalRunButton().click();

    // After run completes, Done button should appear
    await expect(meetingsList.bulkRunModalDoneButton()).toBeVisible();
    await meetingsList.bulkRunModalDoneButton().click();

    // Modal should close
    await expect(meetingsList.bulkRunModalHeading()).not.toBeVisible();
  });

  test("bulk run modal shows empty-state hint when prompt lacks a description", async ({
    meetingsList,
    page,
  }) => {
    await meetingsList.meetingCheckbox("Customer call").click();
    await meetingsList.bulkRunButton().click();

    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: /1:1 Follow-up \(manual\)/ }).click();
    await expect(meetingsList.bulkRunPromptSummary()).toContainText(
      "No description yet. Add one in Prompt Library under Details."
    );
  });

  test("clicking meeting row navigates to detail", async ({
    meetingsList,
    page,
  }) => {
    await meetingsList.meetingRow("Weekly planning").click();
    // Default landing is the Workspace view; flip to Details to reveal tabs.
    await page.waitForURL(/#\/meeting\//);
    const details = page.getByRole("tab", { name: "Details" });
    if (await details.count()) await details.first().click();
    await expect(
      page.getByRole("tab", { name: "Analysis" })
    ).toBeVisible();
  });

  test("bulk delete cancel keeps selected meetings visible", async ({
    meetingsList,
    page,
  }) => {
    await meetingsList.meetingCheckbox("Weekly planning").click();
    await meetingsList.bulkDeleteButton().click();
    await meetingsList.cancelDeleteButton().click();
    await expect(meetingsList.meetingRow("Weekly planning")).toBeVisible();
    await expect(meetingsList.bulkDeleteButton()).toBeVisible();
  });

  test("bulk delete can clear the list into its empty state", async ({
    meetingsList,
    page,
  }) => {
    await meetingsList.selectAllCheckbox().click();
    await meetingsList.bulkDeleteButton().click();
    await meetingsList.confirmDeleteButton().click();
    await expect(meetingsList.emptyState()).toBeVisible();
    await expect(page.getByText("Start a recording from Home, or drop a file here to import.")).toBeVisible();
  });

  test("status badges show correct values", async ({ meetingsList, page }) => {
    await expect(meetingsList.statusBadge("complete")).toBeVisible();
    await expect(meetingsList.statusBadge("processing")).toBeVisible();
    await expect(meetingsList.statusBadge("draft")).toBeVisible();
    await expect(meetingsList.statusBadge("error")).toBeVisible();

    await page.screenshot({
      path: "test-results/screenshots/meetings-list-full.png",
      fullPage: true,
    });
  });
});

// Regression: in a short viewport, rows below the fold must be reachable by
// scrolling inside the table card. Existing specs run at the default viewport
// and would not catch a regression where the card clips overflow rows. The
// fix relies on the card claiming `flex-1 min-h-0` and hosting an internal
// `overflow-y-auto` scroll region with a sticky `<thead>`.
test.describe("Meetings List — short viewport scroll", () => {
  test("last meeting is reachable via in-card scroll, header stays sticky", async ({
    app,
    page,
    meetingsList,
  }) => {
    // Synthesize many meetings so the table comfortably overflows a 500px
    // viewport. Bootstrap is on Home, so MeetingsList hasn't mounted yet —
    // override runs.list before navigating so the list mounts with our seed.
    const manyRuns = Array.from({ length: 30 }, (_, i) => {
      const n = i + 1;
      const id = String(n).padStart(2, "0");
      return {
        run_id: `bulk-run-${id}`,
        title: `Bulk meeting ${id}`,
        description: `Synthetic row ${n}`,
        date: "2026-04-01",
        started: "2026-04-01T15:00:00.000Z",
        ended: "2026-04-01T15:30:00.000Z",
        updated_at: `2026-04-${(n % 28 + 1).toString().padStart(2, "0")}T12:00:00.000Z`,
        status: "complete",
        source_mode: "both",
        duration_minutes: 30,
        tags: [],
        folder_path: `/runs/bulk-${id}`,
        prompt_output_ids: [],
        folder_size_bytes: 1_000_000,
      };
    });

    await page.evaluate((runs) => {
      // Override the mock-api's runs.list so MeetingsList loads our seed.
      const api = (window as unknown as { api: { runs: { list: () => Promise<unknown> } } }).api;
      api.runs.list = async () => runs;
    }, manyRuns);

    // Force a short viewport before MeetingsList mounts so the table card
    // is constrained from the start.
    await page.setViewportSize({ width: 1200, height: 500 });

    await app.navigateTo("Meetings");
    await meetingsList.waitForReady();

    const firstRow = meetingsList.meetingRow("Bulk meeting 01");
    const lastRow = meetingsList.meetingRow("Bulk meeting 30");

    // Precondition: first row is visible, last row is in the DOM but below
    // the visible area. If the card silently clipped overflow (the bug),
    // the last row would still be attached to the DOM but unreachable.
    await expect(firstRow).toBeVisible();
    await expect(lastRow).toBeAttached();
    await expect(lastRow).not.toBeInViewport();

    // The fix: the card hosts an inner scroll region. scrollIntoViewIfNeeded
    // will only succeed if a real scrollable ancestor exists.
    await lastRow.scrollIntoViewIfNeeded();
    await expect(lastRow).toBeInViewport();

    // Sticky header proof: the "Meeting" column label should still be in
    // viewport after scrolling rows beneath it.
    const meetingHeader = page
      .getByRole("columnheader", { name: "Meeting" })
      .first();
    await expect(meetingHeader).toBeInViewport();
  });
});
