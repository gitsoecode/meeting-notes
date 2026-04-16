import { test, expect } from "../fixtures/base.fixture";

test.describe("Meeting Lifecycle", () => {
  test("prepare for later can be reopened after reload and then recorded", async ({
    app,
    page,
    recordView,
    meetingsList,
  }) => {
    await recordView.waitForHomeReady();
    await page.getByRole("button", { name: "Prepare for later" }).click();
    await expect(page.getByText("draft").first()).toBeVisible();

    await page.reload();
    await app.navigateTo("Meetings");
    await meetingsList.waitForReady();
    await meetingsList.meetingRow("Meeting -").first().click();
    await expect(page.getByText("draft").first()).toBeVisible();
    await page.getByRole("button", { name: "Start recording" }).click();
    await expect(page.getByRole("button", { name: "End meeting" })).toBeVisible();
  });

  test("complete meeting can be reopened as draft, then processed again", async ({
    app,
    meetingsList,
    meetingWorkspace,
    page,
  }) => {
    await app.navigateTo("Meetings");
    await meetingsList.waitForReady();
    await meetingsList.meetingRow("Weekly planning").click();
    await meetingWorkspace.waitForReady({ view: "details" });

    await meetingWorkspace.moreActionsButton().click();
    await meetingWorkspace.editAsDraftItem().click();
    await expect(page.getByText("draft").first()).toBeVisible();

    await page.getByRole("button", { name: "Start recording" }).click();
    await page.getByRole("button", { name: "End meeting" }).click();
    await page.getByRole("button", { name: "End meeting" }).last().click();

    await expect(page.getByText("complete").first()).toBeVisible();
  });

  test("bulk delete removes multiple selected meetings from the list", async ({
    app,
    meetingsList,
    page,
  }) => {
    await app.navigateTo("Meetings");
    await meetingsList.waitForReady();
    await meetingsList.checkboxes().nth(0).check({ force: true });
    await meetingsList.checkboxes().nth(1).check({ force: true });
    await meetingsList.bulkDeleteButton().click();
    await meetingsList.confirmDeleteButton().click();
    await expect(page.getByText("Weekly planning")).toHaveCount(0);
    await expect(page.getByText("Customer call")).toHaveCount(0);
  });
});
