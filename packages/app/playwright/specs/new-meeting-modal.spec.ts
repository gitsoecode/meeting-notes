import { test, expect } from "../fixtures/base.fixture";

test.describe("New Meeting Entry", () => {
  test("open-new-meeting action lands on the home composer", async ({ app, page, recordView }) => {
    await app.emitAppAction("open-new-meeting", "tray");
    await recordView.waitForHomeReady();
    await expect(page.getByRole("heading", { name: "New meeting" })).toBeVisible();
  });

  test("home composer can fill title and start recording", async ({ recordView, page }) => {
    await recordView.titleInput().clear();
    await recordView.titleInput().fill("Standup");
    await recordView.startButton().click();
    await expect(recordView.endMeetingButton()).toBeVisible();
    await expect(recordView.recordingLiveBadge()).toBeVisible();
  });

  test("title is pre-filled on first load", async ({ recordView }) => {
    await expect(recordView.titleInput()).not.toHaveValue("");
  });
});
