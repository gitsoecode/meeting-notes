import { test, expect } from "../fixtures/base.fixture";

test.describe("New Meeting Modal", () => {
  test("opens via appAction event", async ({ app, page }) => {
    await app.emitAppAction("open-new-meeting", "tray");
    await expect(
      page.getByRole("heading", { name: "New meeting" })
    ).toBeVisible();
  });

  test("fill title and start recording", async ({ app, page }) => {
    await app.emitAppAction("open-new-meeting");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const titleInput = dialog.locator("#new-meeting-title");
    await titleInput.clear();
    await titleInput.fill("Standup");
    await dialog.getByRole("button", { name: "Start recording" }).click();

    // Modal should close — onStarted navigates to meeting detail
    await expect(dialog).not.toBeVisible();
    // Recording badge appears in the header
    await expect(page.getByText(/Recording/)).toBeVisible();
  });

  test("cancel dismisses modal", async ({ app, page }) => {
    await app.emitAppAction("open-new-meeting");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).not.toBeVisible();
  });

  test("title pre-filled with Untitled Meeting", async ({ app, page }) => {
    await app.emitAppAction("open-new-meeting");
    await expect(page.getByRole("dialog")).toBeVisible();
    const titleInput = page.locator("#new-meeting-title");
    await expect(titleInput).toHaveValue("Untitled Meeting");
  });

  test("Cmd+Enter shortcut starts recording", async ({ app, page }) => {
    await app.emitAppAction("open-new-meeting");
    await expect(page.getByRole("dialog")).toBeVisible();
    const titleInput = page.locator("#new-meeting-title");
    await titleInput.press("Meta+Enter");
    // Modal closes, recording badge appears in header
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.getByText(/Recording/)).toBeVisible();
  });
});
