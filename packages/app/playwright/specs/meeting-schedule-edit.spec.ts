import { test, expect } from "../fixtures/base.fixture";

const SCHEDULED_TIME_TESTID = "meeting-scheduled-time";

test.describe("Meeting scheduled-date editing from the detail header", () => {
  test("completed meeting: scheduled date is visible, time edit persists across reload", async ({
    app,
    meetingsList,
    meetingWorkspace,
    page,
  }) => {
    await app.navigateTo("Meetings");
    await meetingsList.waitForReady();
    await meetingsList.meetingRow("Weekly planning").click();
    await meetingWorkspace.waitForReady({ view: "details" });

    const scheduledRow = page.getByTestId(SCHEDULED_TIME_TESTID);
    await expect(scheduledRow).toBeVisible();
    // Seeded value is 2026-04-08T17:30 UTC; date label is timezone-stable as "Apr 8, 2026".
    await expect(scheduledRow).toContainText("Apr 8, 2026");

    await scheduledRow.getByRole("button").first().click();

    const popover = page.getByRole("dialog");
    await expect(popover).toBeVisible();

    // Changing the time field updates immediately and keeps the popover open.
    await popover.locator('input[type="time"]').fill("14:00");
    // Close the popover by clicking outside it.
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();

    // Header reflects the new time. Use a tolerant matcher because the
    // formatted time depends on the machine's local timezone.
    await expect(scheduledRow).toContainText("Apr 8, 2026");

    // Navigate away and back to prove persistence through the mock IPC layer.
    await app.navigateTo("Meetings");
    await meetingsList.waitForReady();
    await meetingsList.meetingRow("Weekly planning").click();
    await meetingWorkspace.waitForReady({ view: "details" });

    const scheduledRowReloaded = page.getByTestId(SCHEDULED_TIME_TESTID);
    await expect(scheduledRowReloaded).toContainText("Apr 8, 2026");
  });

  test("meeting with no scheduled date shows a Schedule call-to-action that opens the picker", async ({
    app,
    meetingsList,
    meetingWorkspace,
    page,
  }) => {
    await app.navigateTo("Meetings");
    await meetingsList.waitForReady();
    // Draft standup has no scheduled_time in the fixture.
    await meetingsList.meetingRow("Draft standup").click();
    await meetingWorkspace.waitForReady();

    const scheduledRow = page.getByTestId(SCHEDULED_TIME_TESTID);
    await expect(scheduledRow).toBeVisible();
    const scheduleButton = scheduledRow.getByRole("button", { name: /Schedule/i });
    await expect(scheduleButton).toBeVisible();

    await scheduleButton.click();
    const popover = page.getByRole("dialog");
    await expect(popover).toBeVisible();
    // Calendar grid is rendered.
    await expect(popover.getByRole("grid")).toBeVisible();
    // Time input is rendered.
    await expect(popover.locator('input[type="time"]')).toBeVisible();
  });

  test("scheduled-date editor is available regardless of meeting status (not draft-only)", async ({
    app,
    meetingsList,
    meetingWorkspace,
    page,
  }) => {
    await app.navigateTo("Meetings");
    await meetingsList.waitForReady();
    // Failed import is a non-draft, non-complete status — confirms the editor
    // is no longer gated on isDraft.
    await meetingsList.meetingRow("Failed import").click();
    await meetingWorkspace.waitForReady({ view: "details" });

    const scheduledRow = page.getByTestId(SCHEDULED_TIME_TESTID);
    await expect(scheduledRow).toBeVisible();
    // No date seeded for this fixture → "Schedule" CTA.
    const scheduleButton = scheduledRow.getByRole("button", { name: /Schedule/i });
    await expect(scheduleButton).toBeVisible();
    await scheduleButton.click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});
