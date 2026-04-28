import { test, expect } from "../fixtures/base.fixture";

test.describe("Settings → Integrations", () => {
  test.beforeEach(async ({ app, settings }) => {
    await app.navigateTo("Settings");
    await settings.openTab("Integrations");
  });

  test("tab renders the install button and live status indicators", async ({
    page,
  }) => {
    const section = page.getByTestId("integrations-section");
    await expect(section).toBeVisible();

    await expect(page.getByTestId("integrations-install-mcp")).toBeVisible();
    await expect(page.getByTestId("integrations-install-mcp")).toBeEnabled();

    // Live status indicators populate from the mocked status.
    await expect(page.getByTestId("integrations-status-extension")).toContainText(
      /Installed|Not installed|unreadable/
    );
    await expect(page.getByTestId("integrations-status-claude-desktop")).toContainText(
      /Claude Desktop/
    );
    await expect(page.getByTestId("integrations-status-ollama")).toContainText(
      /Ollama/
    );
    await expect(page.getByTestId("integrations-status-db")).toContainText(
      /7 meetings indexed/
    );
  });

  test("clicking install fires the IPC, shows the restart hint, and reveals Uninstall", async ({
    page,
  }) => {
    await page.getByTestId("integrations-install-mcp").click();
    // Mock returns ok → the restart hint renders.
    await expect(page.getByTestId("integrations-opened")).toBeVisible({
      timeout: 5000,
    });
    // After install, the button relabels and an Uninstall button appears.
    await expect(page.getByTestId("integrations-install-mcp")).toContainText(
      /Reinstall/i
    );
    await expect(page.getByTestId("integrations-uninstall-mcp")).toBeVisible();
  });

  test("uninstall removes the entry and hides the Uninstall button", async ({
    page,
  }) => {
    // Install first so the uninstall affordance is present.
    await page.getByTestId("integrations-install-mcp").click();
    await expect(page.getByTestId("integrations-uninstall-mcp")).toBeVisible();
    await page.getByTestId("integrations-uninstall-mcp").click();
    await expect(page.getByTestId("integrations-uninstalled")).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByTestId("integrations-uninstall-mcp")).toHaveCount(0);
  });
});

test.describe("Settings → Integrations (install error path)", () => {
  test.beforeEach(async ({ app, settings }) => {
    await app.navigateTo("Settings");
    await settings.openTab("Integrations");
  });

  test("surfaces the error toast when install fails", async ({
    page,
  }) => {
    // Set the mock-api test flag inline — the mock reads it at call time,
    // so we don't need addInitScript / reload.
    await page.evaluate(() => {
      (window as any).__MOCK_INSTALL_MCP_FAIL__ = true;
    });
    await page.getByTestId("integrations-install-mcp").click();
    const errBox = page.getByTestId("integrations-install-error");
    await expect(errBox).toBeVisible({ timeout: 5000 });
    await expect(errBox).toContainText(/not valid JSON/);
    // The success hint must NOT be shown on the failure branch.
    await expect(page.getByTestId("integrations-opened")).toHaveCount(0);
  });
});
