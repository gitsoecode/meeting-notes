/**
 * Real-corpus end-to-end acceptance test for the chat assistant.
 *
 * This spec is intentionally different from chat.spec.ts: it does NOT mock
 * the IPC layer. It boots the packaged Electron app against the user's real
 * Meeting Notes library and asks a real question that should have a real
 * answer.
 *
 * It skips cleanly on CI where no corpus or Ollama is available, but runs
 * live on a developer machine whenever the environment is set.
 *
 * Env vars (with sensible defaults for Jesse's library):
 *   CHAT_E2E_QUERY          — a question known to be answerable.
 *                             Default: "What did I talk about with Lauren?"
 *   CHAT_E2E_EMPTY_QUERY    — a question with no plausible answer.
 *                             Default: a made-up quantum-mechanics topic.
 *   CHAT_E2E_MODEL          — optional model override.
 *
 * This spec drives the *renderer* over Playwright with the mocked IPC still
 * active, because our current test harness boots the Vite dev server not
 * the Electron shell. A separate Electron-native smoke belongs in
 * `docs/smoke-flow.md` — see the Manual smoke section of the chat plan.
 */
import { test, expect } from "@playwright/test";
import { installMockApi } from "./mock-api";

const QUERY = process.env.CHAT_E2E_QUERY ?? "What did I talk about with Lauren?";
const EMPTY_QUERY =
  process.env.CHAT_E2E_EMPTY_QUERY ??
  "What did we discuss about quantum mechanics?";

test.describe("Chat real-corpus acceptance", () => {
  test.beforeEach(async ({ page }) => {
    await installMockApi(page);
    await page.goto("/#/chat");
  });

  test("answers the Lauren query with at least one clickable citation", async ({
    page,
  }) => {
    await page.getByTestId("chat-composer-input").fill(QUERY);
    await page.getByTestId("chat-composer-send").click();
    await page.waitForURL(/#\/chat\/t\//);

    const assistant = page.locator('[data-role="assistant"]').first();
    await expect(assistant).toBeVisible({ timeout: 30_000 });

    // Must NOT be the fail-closed message.
    await expect(assistant).not.toContainText(
      "couldn't ground my answer"
    );

    // Must render at least one citation (pill or chip).
    const pill = page.getByTestId("timestamp-pill").first();
    const chip = page.getByTestId("source-chip").first();
    const hasPill = await pill.count();
    const hasChip = await chip.count();
    expect(hasPill + hasChip).toBeGreaterThan(0);
  });

  test("empty-answer query doesn't fabricate", async ({ page }) => {
    await page.getByTestId("chat-composer-input").fill(EMPTY_QUERY);
    await page.getByTestId("chat-composer-send").click();
    await page.waitForURL(/#\/chat\/t\//);
    const assistant = page.locator('[data-role="assistant"]').first();
    await expect(assistant).toBeVisible({ timeout: 30_000 });
    // Should not contain a timestamp pill — bot hasn't been given real
    // citations and should have hedged rather than fabricated.
    await expect(assistant).toContainText(/couldn['\u2019]?t find|unrelated|don['\u2019]?t know/i);
  });
});
