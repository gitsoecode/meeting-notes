import { test, expect } from "../fixtures/base.fixture";

test.describe("Prompt Library", () => {
  test.beforeEach(async ({ app }) => {
    await app.navigateTo("Prompt Library");
  });

  test("initial load shows library and summary selected", async ({
    promptsEditor,
    page,
  }) => {
    await expect(promptsEditor.libraryHeading()).toBeVisible();
    await expect(promptsEditor.rootPromptItem()).toContainText("Summary + Action Items");
    await expect(promptsEditor.titleInput()).toHaveValue("Summary + Action Items");
    await expect(promptsEditor.modelCombobox()).toContainText("qwen3.5:9b");

    await page.screenshot({
      path: "test-results/screenshots/prompts-editor-initial.png",
      fullPage: true,
    });
  });

  test("prompt library normalizes navigation into pre-loaded and custom groups", async ({
    promptsEditor,
  }) => {
    await expect(promptsEditor.rootPromptItem()).toContainText("Summary + Action Items");
    await expect(promptsEditor.rootPromptItem()).toContainText("Primary prompt");
    await expect(promptsEditor.preloadedPromptsGroup()).toContainText("1:1 Follow-up");
    await expect(promptsEditor.preloadedPromptsGroup()).toContainText("Decision Log");
    await expect(promptsEditor.customPromptsGroup()).toContainText("Follow-up Brief");
  });

  test("route deep link selects the summary prompt", async ({ app, promptsEditor }) => {
    await app.navigateRoute({ name: "prompts", promptId: "summary" });
    await expect(promptsEditor.titleInput()).toHaveValue("Summary + Action Items");
  });

  test("route deep link selects a non-summary prompt", async ({ app, promptsEditor }) => {
    await app.navigateRoute({ name: "prompts", promptId: "decision-log" });
    await expect(promptsEditor.titleInput()).toHaveValue("Decision Log");
  });

  test("selecting a different prompt updates editor fields", async ({
    promptsEditor,
  }) => {
    await promptsEditor.promptSidebarItem("Decision Log").click();
    await expect(promptsEditor.titleInput()).toHaveValue("Decision Log");
    await expect(promptsEditor.filenameInput()).toHaveValue("decision-log.md");
    await promptsEditor.detailsAccordion().click();
    await expect(promptsEditor.descriptionInput()).toHaveValue("Capture decisions and open questions.");
  });

  test("edit title and save", async ({ promptsEditor }) => {
    await promptsEditor.titleInput().clear();
    await promptsEditor.titleInput().fill("Updated Summary");
    await promptsEditor.saveButton().click();
    await expect(promptsEditor.promptSidebarItem("Updated Summary")).toBeVisible();
    await expect(promptsEditor.saveButton()).toBeDisabled();
  });

  test("edit description and save", async ({ promptsEditor, page }) => {
    await promptsEditor.detailsAccordion().click();
    await promptsEditor.descriptionInput().fill(
      "A crisp recap for meetings that need a reusable summary."
    );
    await promptsEditor.saveButton().click();

    await expect(promptsEditor.saveButton()).toBeDisabled();
    await page.reload();
    await promptsEditor.detailsAccordion().click();
    await expect(promptsEditor.descriptionInput()).toHaveValue(
      "A crisp recap for meetings that need a reusable summary."
    );
  });

  test("clearing description saves as empty without leaving dirty state", async ({
    promptsEditor,
  }) => {
    await promptsEditor.promptSidebarItem("Decision Log").click();
    await promptsEditor.detailsAccordion().click();
    await promptsEditor.descriptionInput().fill("");
    await promptsEditor.saveButton().click();

    await expect(promptsEditor.descriptionInput()).toHaveValue("");
    await expect(promptsEditor.saveButton()).toBeDisabled();
  });

  test("auto-run toggle in active prompt area", async ({
    promptsEditor,
  }) => {
    await promptsEditor.promptSidebarItem("Decision Log").click();
    const activeSwitch = promptsEditor.activeAutoRunSwitch();
    const currentState = await activeSwitch.getAttribute("aria-checked");
    await activeSwitch.click();
    const newState = await activeSwitch.getAttribute("aria-checked");
    expect(newState).not.toBe(currentState);
  });

  test("run against meeting modal opens from more menu and can be cancelled", async ({
    promptsEditor,
    page,
  }) => {
    await promptsEditor.promptSidebarItem("Decision Log").click();
    await promptsEditor.moreButton().click();
    await promptsEditor.runAgainstMeetingItem().click();
    await expect(promptsEditor.runAgainstModalHeading()).toBeVisible();
    await expect(page.getByText("Weekly planning")).toBeVisible();
    await promptsEditor.runAgainstModalCancel().click();
    await expect(promptsEditor.runAgainstModalHeading()).not.toBeVisible();
  });

  test("finder action and run-against-meeting actions are functional", async ({
    app,
    promptsEditor,
    page,
  }) => {
    await promptsEditor.finderButton().click();
    await expect
      .poll(async () => await app.lastExternalAction())
      .toMatchObject({
        type: "open-prompt-in-finder",
        payload: { promptId: "summary" },
      });

    await promptsEditor.promptSidebarItem("Decision Log").click();
    await promptsEditor.moreButton().click();
    await promptsEditor.runAgainstMeetingItem().click();
    await promptsEditor.runAgainstMeetingSearchInput().fill("weekly");
    await expect(page.getByText("Weekly planning")).toBeVisible();
    await expect(page.getByText("Customer call")).toHaveCount(0);
    await expect(promptsEditor.showAllMeetingsButton()).toHaveCount(0);
    await promptsEditor.runAgainstMeetingSearchInput().clear();
    await page.getByRole("button", { name: /Weekly planning/ }).click();
    await expect(promptsEditor.runAgainstMeetingRunButton()).toBeEnabled();
    await promptsEditor.runAgainstMeetingRunButton().click();
    await expect(promptsEditor.runAgainstModalHeading()).not.toBeVisible();
  });

  test("new prompt creation", async ({ promptsEditor, page }) => {
    await promptsEditor.newPromptButton().click();
    const dialog = promptsEditor.newPromptDialog();
    await expect(
      dialog.getByRole("heading", { name: "New prompt" })
    ).toBeVisible();

    await expect(promptsEditor.createPromptButton()).toBeDisabled();

    await promptsEditor.newPromptIdInput().fill("follow-up-email");
    await promptsEditor.newPromptLabelInput().fill("Follow-up email");
    await promptsEditor.newPromptFilenameInput().fill("follow-up-email.md");

    await expect(promptsEditor.createPromptButton()).toBeEnabled();
    await promptsEditor.createPromptButton().click();

    await expect(page.getByText("Follow-up email")).toBeVisible();
  });

  test("new prompt modal can be cancelled", async ({ promptsEditor }) => {
    await promptsEditor.newPromptButton().click();
    await expect(promptsEditor.newPromptDialog()).toBeVisible();
    await promptsEditor.runAgainstModalCancel().click();
    await expect(promptsEditor.newPromptDialog()).not.toBeVisible();
  });

  test("details accordion and reset to default are available", async ({
    promptsEditor,
  }) => {
    await expect(promptsEditor.detailsAccordion()).toBeVisible();
    await promptsEditor.moreButton().click();
    await expect(promptsEditor.resetToDefaultItem()).toBeVisible();
  });

  test("reset to default with confirm dialog", async ({
    promptsEditor,
    page,
  }) => {
    await promptsEditor.moreButton().click();
    await promptsEditor.resetToDefaultItem().click();
    await page.getByRole("button", { name: "Reset prompt" }).click();
    await expect(promptsEditor.titleInput()).toHaveValue("Summary + Action Items");
  });

  test("reset to default can be cancelled", async ({
    promptsEditor,
    page,
  }) => {
    await promptsEditor.moreButton().click();
    await promptsEditor.resetToDefaultItem().click();
    await page.getByRole("button", { name: "Keep current version" }).click();
    await expect(page.getByRole("button", { name: "Reset prompt" })).toHaveCount(0);
  });

  test("dirty state is clearly marked after editing", async ({
    promptsEditor,
  }) => {
    await promptsEditor.titleInput().fill("Summary draft");
    await expect(promptsEditor.saveButton()).toBeEnabled();
  });

  test("switching prompts reseeds the markdown body editor", async ({
    promptsEditor,
    page,
  }) => {
    // The body editor is Crepe-backed (mount-once contract). Without a `key`
    // tied to the active prompt id, switching prompts would leave the first
    // prompt's body visible even though draftBody state changed. This test
    // guards that the remount-on-switch wiring is in place.
    const body = page.locator("main .markdown-editor [contenteditable='true']");

    await expect(promptsEditor.titleInput()).toHaveValue("Summary + Action Items");
    await expect(body).toContainText("Produce a concise summary");

    await promptsEditor.promptSidebarItem("Decision Log").click();
    await expect(promptsEditor.titleInput()).toHaveValue("Decision Log");
    await expect(body).toContainText("List the decisions made in the meeting");
    await expect(body).not.toContainText("Produce a concise summary");

    await promptsEditor.promptSidebarItem("1:1 Follow-up").click();
    await expect(promptsEditor.titleInput()).toHaveValue("1:1 Follow-up");
    await expect(body).toContainText("Draft a concise 1:1 follow-up");
    await expect(body).not.toContainText("List the decisions made in the meeting");
  });

  test("save and more stay visible in a shorter viewport", async ({
    promptsEditor,
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 760 });

    const viewportHeight = page.viewportSize()?.height ?? 0;
    const saveBox = await promptsEditor.saveButton().boundingBox();
    const moreBox = await promptsEditor.moreButton().boundingBox();

    expect(saveBox).not.toBeNull();
    expect(moreBox).not.toBeNull();
    expect(Math.round((saveBox?.y ?? 0) + (saveBox?.height ?? 0))).toBeLessThanOrEqual(viewportHeight);
    expect(Math.round((moreBox?.y ?? 0) + (moreBox?.height ?? 0))).toBeLessThanOrEqual(viewportHeight);
  });
});
