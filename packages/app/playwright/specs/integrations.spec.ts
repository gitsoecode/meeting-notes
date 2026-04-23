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
      /Not detected|Detected|Detection unavailable/
    );
    await expect(page.getByTestId("integrations-status-ollama")).toContainText(
      /Ollama/
    );
    await expect(page.getByTestId("integrations-status-db")).toContainText(
      /7 meetings indexed/
    );

    // Docs link is present and points at the public setup guide.
    const docsLink = page.getByTestId("integrations-docs-link");
    await expect(docsLink).toBeVisible();
    await expect(docsLink).toHaveAttribute("href", /claude-desktop-setup/);
  });

  test("clicking install fires the IPC and shows the success hint", async ({
    page,
  }) => {
    await page.getByTestId("integrations-install-mcp").click();
    // Mock returns ok → the "come back — we'll confirm" hint renders.
    await expect(page.getByTestId("integrations-opened")).toBeVisible({
      timeout: 5000,
    });
  });
});

test.describe("Settings → Integrations (install error path)", () => {
  test.beforeEach(async ({ app, settings }) => {
    await app.navigateTo("Settings");
    await settings.openTab("Integrations");
  });

  test("surfaces the error toast + docs link when install fails", async ({
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
    await expect(errBox).toContainText(/Couldn't open Gistlist\.mcpb/);
    await expect(errBox.getByRole("link", { name: /setup guide/i })).toBeVisible();
    // The success hint must NOT be shown on the failure branch.
    await expect(page.getByTestId("integrations-opened")).toHaveCount(0);
  });
});
