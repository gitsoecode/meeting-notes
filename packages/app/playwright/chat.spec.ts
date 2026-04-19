import { test, expect } from "@playwright/test";
import { installMockApi } from "./mock-api";

test.describe("Chat assistant (fixture-mocked)", () => {
  test.beforeEach(async ({ page }) => {
    await installMockApi(page);
    await page.goto("/#/chat");
  });

  test("renders empty-state with composer and greeting", async ({ page }) => {
    await expect(page.getByText("Ask about your meetings.")).toBeVisible();
    await expect(page.getByTestId("chat-composer-input")).toBeVisible();
  });

  test("sending a Lauren question produces a citation pill", async ({ page }) => {
    const input = page.getByTestId("chat-composer-input");
    await input.fill("What did I talk about with Lauren?");
    await page.getByTestId("chat-composer-send").click();

    // Wait for the URL to flip to the thread route.
    await page.waitForURL(/#\/chat\/t\//);
    const assistant = page.locator('[data-role="assistant"]').first();
    await expect(assistant).toBeVisible();
    await expect(page.getByTestId("timestamp-pill")).toBeVisible();
  });

  test("empty-result question produces graceful fallback", async ({ page }) => {
    await page
      .getByTestId("chat-composer-input")
      .fill("totally unrelated random subject");
    await page.getByTestId("chat-composer-send").click();
    await page.waitForURL(/#\/chat\/t\//);
    const assistant = page.locator('[data-role="assistant"]').first();
    // Use a regex that tolerates both straight and curly apostrophes.
    await expect(assistant).toContainText(/couldn['\u2019]?t find|unrelated/i);
  });

  test("Show all threads link opens the full thread list", async ({ page }) => {
    await page
      .getByTestId("chat-composer-input")
      .fill("What did I talk about with Lauren?");
    await page.getByTestId("chat-composer-send").click();
    await page.waitForURL(/#\/chat\/t\//);
    // Return to the empty chat state via the in-app Back button so mock
    // state is preserved (page.goto would reset the addInitScript mock).
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.waitForURL(/#\/chat(?!\/)/);
    await expect(page.getByTestId("chat-show-all")).toBeVisible();
    await page.getByTestId("chat-show-all").click();
    await expect(page.getByTestId("chat-thread-search")).toBeVisible();
    await expect(page.getByTestId("chat-thread-row")).toHaveCount(1);
  });
});
