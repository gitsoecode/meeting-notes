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
  await expect(page.getByRole("button", { name: "End meeting" })).toBeVisible();
  await page.getByRole("button", { name: "End meeting" }).click();
  await expect(page.getByRole("heading", { name: "End meeting" })).toBeVisible();
  await page.getByRole("button", { name: "End meeting" }).last().click();

  await expect(page.getByRole("tab", { name: "Summary" })).toHaveAttribute(
    "data-state",
    "active"
  );
  await page.getByRole("tab", { name: "Transcript" }).click();
  await expect(page.getByText("Welcome everyone.")).toBeVisible();

  await page.getByRole("tab", { name: "Notes" }).click();
  await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("tab", { name: "Analysis" }).click();
  await page.getByRole("button", { name: /Decision Log/ }).click();
  await page.getByRole("button", { name: "Run prompt", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Decisions" })).toBeVisible();

  await page.getByRole("tab", { name: "Metadata" }).click();
  await expect(page.getByText("Run details")).toBeVisible();

  await page.locator("aside").getByRole("button", { name: "Prompt Library" }).click();
  await expect(page.getByRole("heading", { name: "Prompt Library" })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Meetings" })).toBeVisible();

  await page.getByPlaceholder("Search meetings").fill("customer");
  await expect(page.getByText("Customer call").first()).toBeVisible();
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
  await page.getByText("Customer call").first().click();
  await expect(page.getByText("Processing locally with qwen3.5:9b")).toBeVisible();

});
