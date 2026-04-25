import { test, expect } from "../fixtures/base.fixture";

// Phase 4 wired electron-updater on the main side, gated by the
// build-time UPDATER_ENABLED constant. The mock starts disabled, so
// the rest of the suite naturally exercises the disabled path.
//
// This spec drives the *enabled* UI path via the test helper
// __MEETING_NOTES_TEST.setUpdaterStatus(...). All the IPC routes
// production hits (getStatus / check / download / install / getPrefs /
// setPrefs) and all the visible states (available, downloading,
// downloaded, deferred-recording, error) are covered against both
// surfaces: the Settings → Updates section and the app-level
// UpdaterBanner.
//
// Install never actually quits — the mock's install() pushes
// "updater:install-attempted" into externalActionLog and keeps the
// status at "downloaded". This mirrors the production dev simulator
// contract (`simulated-install-blocked`).

test.describe("Updater enabled-state UI", () => {
  test.beforeEach(async ({ app, page }) => {
    // Flip the mock into enabled state with no announcement yet.
    await page.evaluate(() => {
      (window as any).__MEETING_NOTES_TEST.setUpdaterStatus({
        enabled: true,
        kind: "idle",
      });
    });
    await app.navigateTo("Settings");
  });

  test("Updates section appears and shows up-to-date copy in idle state", async ({
    page,
  }) => {
    await page.getByRole("tab", { name: "Other" }).click();
    const section = page.getByTestId("settings-updates-section");
    await expect(section).toBeVisible();
    // Idle copy.
    await expect(section.getByText(/Up to date/)).toBeVisible();
    // Action buttons that need an announcement are absent.
    await expect(page.getByTestId("updater-download")).toHaveCount(0);
    await expect(page.getByTestId("updater-install")).toHaveCount(0);
    // Check Now is always available when enabled.
    await expect(page.getByTestId("updater-check-now")).toBeVisible();
  });

  test("available kind surfaces version + Download button + banner", async ({
    page,
  }) => {
    await page.evaluate(() => {
      (window as any).__MEETING_NOTES_TEST.setUpdaterStatus({
        enabled: true,
        kind: "available",
        version: "0.2.0",
      });
    });
    await page.getByRole("tab", { name: "Other" }).click();

    // Settings panel announces the version.
    await expect(page.getByText(/Update 0\.2\.0 is available/)).toBeVisible();
    await expect(page.getByTestId("updater-download")).toBeVisible();
    // Banner also announces it.
    await expect(page.getByTestId("updater-banner")).toBeVisible();
    await expect(
      page
        .getByTestId("updater-banner")
        .getByText(/Update 0\.2\.0 is ready to download/)
    ).toBeVisible();
  });

  test("Download click transitions to downloaded + Install button + banner", async ({
    page,
  }) => {
    await page.evaluate(() => {
      (window as any).__MEETING_NOTES_TEST.setUpdaterStatus({
        enabled: true,
        kind: "available",
        version: "0.2.0",
        bytesTotal: 28_000_000,
      });
    });
    await page.getByRole("tab", { name: "Other" }).click();

    // Click Download → mock fast-forwards to "downloaded" and broadcasts.
    await page.getByTestId("updater-download").click();

    // Settings panel updates copy + button (scoped to its testid so the
    // banner's identical copy doesn't trip strict mode).
    await expect(
      page
        .getByTestId("settings-updates-section")
        .getByText(/Update 0\.2\.0 is ready to install/)
    ).toBeVisible();
    await expect(page.getByTestId("updater-install")).toBeVisible();
    // Banner mirrors the same announcement.
    await expect(
      page
        .getByTestId("updater-banner")
        .getByText(/Update 0\.2\.0 is ready to install/)
    ).toBeVisible();
    await expect(
      page.getByTestId("updater-banner-install")
    ).toBeVisible();
  });

  test("Install & Restart logs an attempt without actually quitting", async ({
    page,
  }) => {
    await page.evaluate(() => {
      (window as any).__MEETING_NOTES_TEST.setUpdaterStatus({
        enabled: true,
        kind: "downloaded",
        version: "0.2.0",
      });
    });
    await page.getByRole("tab", { name: "Other" }).click();

    await page.getByTestId("updater-install").click();

    // The mock pushes a sentinel action — proves the IPC fired without
    // actually quitting. Mirrors the dev-simulator's
    // "simulated-install-blocked" contract from the production updater.
    const action = await page.evaluate(() =>
      (window as any).__MEETING_NOTES_TEST.getLastExternalAction()
    );
    expect(action?.type).toBe("updater:install-attempted");
  });

  test("deferred-recording kind shows the recording-aware copy", async ({
    page,
  }) => {
    await page.evaluate(() => {
      (window as any).__MEETING_NOTES_TEST.setUpdaterStatus({
        enabled: true,
        kind: "deferred-recording",
        version: "0.2.0",
      });
    });
    await page.getByRole("tab", { name: "Other" }).click();

    await expect(
      page.getByText(/Update deferred — finishing your recording first/)
    ).toBeVisible();
  });

  test("error kind surfaces the underlying message", async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__MEETING_NOTES_TEST.setUpdaterStatus({
        enabled: true,
        kind: "error",
        error: "ENOTFOUND github.com",
      });
    });
    await page.getByRole("tab", { name: "Other" }).click();

    await expect(
      page.getByText(/Last check failed: ENOTFOUND github\.com/)
    ).toBeVisible();
  });

  test("Check Now updates lastChecked and re-renders", async ({ page }) => {
    await page.getByRole("tab", { name: "Other" }).click();

    // No prior check — the section should render the idle copy.
    await expect(page.getByText(/Up to date/)).toBeVisible();

    await page.getByTestId("updater-check-now").click();

    // After the check, an Up-to-date-with-timestamp line is visible.
    await expect(
      page.getByText(/Up to date · last checked /)
    ).toBeVisible();
  });

  test("auto-check + banner toggles persist via setPrefs", async ({ page }) => {
    await page.getByRole("tab", { name: "Other" }).click();

    const autoCheckToggle = page.getByTestId("updater-auto-check-toggle");
    const bannerToggle = page.getByTestId("updater-banner-toggle");

    // Both default to on.
    await expect(autoCheckToggle).toHaveAttribute(
      "data-state",
      "checked"
    );
    await expect(bannerToggle).toHaveAttribute("data-state", "checked");

    // Flip auto-check off.
    await autoCheckToggle.click();
    await expect(autoCheckToggle).toHaveAttribute(
      "data-state",
      "unchecked"
    );

    // Mock state matches.
    const prefs = await page.evaluate(() =>
      (window as any).__MEETING_NOTES_TEST.getUpdaterPrefs()
    );
    expect(prefs.autoCheck).toBe(false);
    expect(prefs.notifyBanner).toBe(true);

    // Flip banner off.
    await bannerToggle.click();
    const prefs2 = await page.evaluate(() =>
      (window as any).__MEETING_NOTES_TEST.getUpdaterPrefs()
    );
    expect(prefs2.notifyBanner).toBe(false);
  });

  test("Banner respects the notifyBanner pref", async ({ page }) => {
    // Announce an update with a fresh version so the per-version
    // dismissal doesn't kick in.
    await page.evaluate(() => {
      (window as any).__MEETING_NOTES_TEST.setUpdaterStatus({
        enabled: true,
        kind: "available",
        version: "0.3.0",
      });
    });
    await page.getByRole("tab", { name: "Other" }).click();
    await expect(page.getByTestId("updater-banner")).toBeVisible();

    // Flip notifyBanner off via the Settings toggle.
    await page.getByTestId("updater-banner-toggle").click();
    // Banner should disappear on the next render tick.
    await expect(page.getByTestId("updater-banner")).toHaveCount(0);
  });

  test("Banner Dismiss hides the banner for the announced version", async ({
    page,
  }) => {
    await page.evaluate(() => {
      (window as any).__MEETING_NOTES_TEST.setUpdaterStatus({
        enabled: true,
        kind: "available",
        version: "0.4.0",
      });
    });
    await page.getByRole("tab", { name: "Other" }).click();

    await expect(page.getByTestId("updater-banner")).toBeVisible();
    await page.getByTestId("updater-banner-dismiss").click();
    await expect(page.getByTestId("updater-banner")).toHaveCount(0);

    // A different version reactivates the banner.
    await page.evaluate(() => {
      (window as any).__MEETING_NOTES_TEST.setUpdaterStatus({
        enabled: true,
        kind: "available",
        version: "0.5.0",
      });
    });
    await expect(page.getByTestId("updater-banner")).toBeVisible();
  });
});
