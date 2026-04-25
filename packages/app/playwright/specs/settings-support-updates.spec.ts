import { test, expect } from "../fixtures/base.fixture";

// Phase 4 + 5 added Updates and Support sections to Settings → Other.
// This spec locks the visibility contract:
//
//   - Updates section is HIDDEN when the updater is build-disabled
//     (UPDATER_ENABLED=false → status.enabled=false). The mock returns
//     disabled status by default, so this is the default beta state.
//   - Updates section APPEARS when the dev simulator (or a real
//     UPDATER_ENABLED build) reports an enabled status. Mock test
//     helpers can flip this.
//   - Support section is ALWAYS visible. Send Feedback / Reveal Logs /
//     View Licenses buttons each fire the corresponding api.support.*
//     method, observable via the externalActionLog the mock records.

test.describe("Settings — Support + Updates sections", () => {
  test.beforeEach(async ({ app }) => {
    await app.navigateTo("Settings");
  });

  test("Updates section is hidden when the updater is build-disabled", async ({
    page,
  }) => {
    // Click the "Other" tab.
    await page.getByRole("tab", { name: "Other" }).click();

    // Mock returns `enabled: false` from getStatus by default — the
    // Updates section should not render.
    await expect(
      page.getByTestId("settings-updates-section")
    ).toHaveCount(0);
  });

  test("Support section exposes Send Feedback / Reveal Logs / View Licenses", async ({
    page,
  }) => {
    await page.getByRole("tab", { name: "Other" }).click();

    const support = page.getByTestId("settings-support-section");
    await expect(support).toBeVisible();

    // All three buttons are present in the section.
    await expect(page.getByTestId("support-send-feedback")).toBeVisible();
    await expect(page.getByTestId("support-reveal-logs")).toBeVisible();
    await expect(page.getByTestId("support-view-licenses")).toBeVisible();
  });

  test("Send Feedback button calls api.support.openFeedbackMail", async ({
    page,
  }) => {
    await page.getByRole("tab", { name: "Other" }).click();
    await page.getByTestId("support-send-feedback").click();

    const lastAction = await page.evaluate(() =>
      (window as any).__MEETING_NOTES_TEST.getLastExternalAction()
    );
    expect(lastAction?.type).toBe("support:open-feedback-mail");
  });

  test("Reveal Logs button calls api.support.revealLogsInFinder", async ({
    page,
  }) => {
    await page.getByRole("tab", { name: "Other" }).click();
    await page.getByTestId("support-reveal-logs").click();

    const lastAction = await page.evaluate(() =>
      (window as any).__MEETING_NOTES_TEST.getLastExternalAction()
    );
    expect(lastAction?.type).toBe("support:reveal-logs");
  });

  test("View Licenses button calls api.support.openLicensesFile", async ({
    page,
  }) => {
    await page.getByRole("tab", { name: "Other" }).click();
    await page.getByTestId("support-view-licenses").click();

    const lastAction = await page.evaluate(() =>
      (window as any).__MEETING_NOTES_TEST.getLastExternalAction()
    );
    expect(lastAction?.type).toBe("support:open-licenses");
  });
});
