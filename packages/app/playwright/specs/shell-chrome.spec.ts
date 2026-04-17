import { test, expect } from "../fixtures/base.fixture";

/**
 * Shell chrome sizing regressions:
 * - Sidebar should default to 14rem (224px) on desktop.
 * - Collapse toggle should switch to a 4.5rem (88px) rail and persist across reload.
 * - No route should produce a page-level horizontal scrollbar at the configured
 *   desktop viewport (1440×900) or after resizing to the app's min width.
 */
test.describe("Shell chrome", () => {
  test("sidebar defaults to 224px and collapses to 88px rail", async ({ app, page }) => {
    const sidebar = app.sidebar;
    await expect(sidebar).toBeVisible();

    const widthAt = async () => (await sidebar.boundingBox())?.width ?? 0;
    expect(await widthAt()).toBeCloseTo(224, 0);

    // Collapse — desktop trigger lives inside the sidebar header.
    const collapse = sidebar.getByRole("button", { name: /Collapse sidebar/i });
    await collapse.click();
    await expect.poll(widthAt).toBeCloseTo(88, 0);

    // Persists across reload.
    await page.reload({ waitUntil: "domcontentloaded" });
    await app.waitForRoute("Home");
    await expect.poll(widthAt).toBeCloseTo(88, 0);

    // Expand again for the rest of the suite.
    const expand = app.sidebar.getByRole("button", { name: /Expand sidebar/i });
    await expand.click();
    await expect.poll(widthAt).toBeCloseTo(224, 0);
  });

  test("no route shows a page-level horizontal scrollbar", async ({ app, page }) => {
    const hasHorizontalScroll = () =>
      page.evaluate(() => {
        const el = document.documentElement;
        return el.scrollWidth - el.clientWidth;
      });

    for (const route of ["Home", "Meetings", "Prompt Library", "Activity", "Settings"] as const) {
      await app.navigateTo(route);
      expect(await hasHorizontalScroll(), `horizontal overflow on ${route}`).toBeLessThanOrEqual(1);
    }
  });

  test("meeting detail tabs do not cause page-level horizontal scroll", async ({
    app,
    meetingsList,
    page,
  }) => {
    await app.navigateTo("Meetings");
    await meetingsList.waitForReady();
    await meetingsList.meetingRow("Weekly planning").click();

    // Switch to Details view if not already there.
    const detailsToggle = page.getByRole("tab", { name: /^Details$/ });
    if ((await detailsToggle.count()) > 0 && (await detailsToggle.getAttribute("data-state")) !== "active") {
      await detailsToggle.click();
    }

    for (const tab of ["Metadata", "Summary", "Analysis", "Transcript", "Recording", "Files"]) {
      const trigger = page.getByRole("tab", { name: new RegExp(`^${tab}`) });
      if (!(await trigger.count())) continue;
      await trigger.click();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow on Details → ${tab}`).toBeLessThanOrEqual(1);
    }
  });
});
