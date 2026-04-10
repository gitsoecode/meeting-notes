import { expect, test } from "@playwright/test";
import { installMockApi } from "./mock-api";

test.beforeEach(async ({ page }) => {
  await installMockApi(page);
  await page.goto("/");
});

test("runs through home, modal, recording, meeting tabs, and prompts workflows", async ({
  page,
}) => {
  await expect(page.getByText("Start or import a meeting")).toBeVisible();

  await page.evaluate(() => {
    window.__MEETING_NOTES_TEST.emitAppAction("open-new-meeting", "tray");
  });
  await expect(page.getByRole("heading", { name: "New meeting" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByRole("button", { name: "End and process" })).toBeVisible();
  await page.getByRole("button", { name: "End and process" }).click();

  await expect(page.getByRole("tab", { name: "Summary" })).toHaveAttribute(
    "data-state",
    "active"
  );
  await page.getByRole("tab", { name: "Transcript" }).click();
  await expect(page.getByText("Welcome everyone.")).toBeVisible();

  await page.getByRole("tab", { name: "Notes" }).click();
  await expect(page.getByRole("button", { name: "Edit notes" })).toBeVisible();
  await page.getByRole("button", { name: "Edit notes" }).click();
  await expect(page.getByRole("button", { name: "Save notes" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("tab", { name: "Analysis" }).click();
  await page.getByRole("button", { name: "Run prompt" }).click();
  await expect(page.getByText("Decisions")).toBeVisible();

  await page.getByRole("tab", { name: "Metadata" }).click();
  await expect(page.getByText("Run details")).toBeVisible();

  await page.getByRole("button", { name: "Prompt Library" }).click();
  await expect(page.getByText("Prompt workspace")).toBeVisible();
  await page.getByRole("button", { name: "Decision Log" }).click();
  await page.getByRole("switch", { name: "Auto-run" }).click();
  await expect(page.getByRole("switch", { name: "Auto-run" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Run against meeting" }).click();
  await expect(page.getByRole("heading", { name: /Run "Decision Log"/ })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "New prompt" }).click();
  const newPromptDialog = page.getByRole("dialog");
  await expect(
    newPromptDialog.getByRole("heading", { name: "New prompt" })
  ).toBeVisible();
  await newPromptDialog.getByLabel("ID").fill("follow-up-email");
  await newPromptDialog.getByLabel("Label").fill("Follow-up email");
  await newPromptDialog.getByLabel("Output filename").fill("follow-up-email.md");
  await newPromptDialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Follow-up email")).toBeVisible();
});

test("covers meetings list, bulk run, import, settings, logs, and processing states", async ({
  page,
}) => {
  await page.locator("aside").getByRole("button", { name: "Meetings" }).click();
  await expect(page.getByText("Recent and imported meetings")).toBeVisible();

  await page.getByPlaceholder("Search meetings").fill("customer");
  await expect(page.getByRole("button", { name: /Customer call/ }).first()).toBeVisible();
  await page.getByPlaceholder("Search meetings").fill("");

  await page.getByLabel("Select Customer call").first().check({ force: true });
  await page.getByRole("button", { name: /Run prompt on 1/ }).click();
  await expect(page.getByRole("heading", { name: /Run prompt on 1 meetings/ })).toBeVisible();
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "Import meeting" }).click();
  await expect(page.getByRole("heading", { name: "mock meeting" })).toBeVisible();

  await page.locator("aside").getByRole("button", { name: "Meetings" }).click();
  await page.getByRole("button", { name: /Customer call/ }).first().click();
  await expect(page.getByText("Processing locally with qwen3.5:9b")).toBeVisible();

});
