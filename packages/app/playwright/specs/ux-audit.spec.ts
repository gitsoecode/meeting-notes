import { test, expect, type AuditObservation } from "../fixtures/base.fixture";

test.describe("UX Audit: Intent-Driven Evaluation", () => {
  test('Flow 1: "I just opened the app — what do I do?"', async ({
    app,
    page,
    audit,
  }) => {
    const counts = await app.countInteractiveElements();
    const cardCount = await app.countCards();

    // Check: how many competing actions on home screen?
    const startBtn = page.getByRole("button", { name: /Start recording/ });
    const importBtn = page.getByRole("button", { name: /Import meeting/ });
    const startVisible = await startBtn.isVisible();
    const importVisible = await importBtn.isVisible();

    const observations: string[] = [
      `Total interactive elements on home screen: ${counts.total} (${counts.buttons} buttons, ${counts.inputs} inputs)`,
      `Card components visible: ${cardCount}`,
      `Start recording button visible: ${startVisible}`,
      `Import meeting button visible at equal weight: ${importVisible}`,
      "ISSUE: Two equally-weighted primary cards compete for attention — new recording and import are at the same visual hierarchy level",
      "ISSUE: Import card still consumes substantial above-fold space on smaller screens, which weakens the focus on starting a new recording",
    ];

    await audit({
      intent: "I just opened the app for the first time — what do I do?",
      expectations:
        "A clear primary action. Minimal decisions required. One obvious 'start here' button.",
      observations,
      elementCounts: counts,
      screenshotName: "ux-flow1-first-open",
    });

    // The start button should be the clear primary action
    expect(startVisible).toBe(true);
  });

  test('Flow 2: "I want to start a new meeting right now"', async ({
    page,
    audit,
  }) => {
    // Check: is title default useful?
    // The RecordView label doesn't have htmlFor, so use placeholder to find the input
    const titleInput = page.getByPlaceholder("Untitled Meeting");
    const titleValue = await titleInput.inputValue();

    // Check: how many fields before Start?
    const descriptionVisible = await page
      .getByPlaceholder("What's this meeting about?")
      .isVisible();
    const startBtn = page.getByRole("button", { name: /Start recording/ });
    const startBtnBox = await startBtn.boundingBox();

    const observations: string[] = [
      `Title default value: "${titleValue}"`,
      `ISSUE: Default "Untitled Meeting" is not useful — user must clear and retype every time`,
      `RECOMMENDATION: Use blank input with placeholder "e.g., Weekly standup — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}" or auto-generate from date`,
      `Description field visible before start: ${descriptionVisible}`,
      `Start button position: ${startBtnBox ? `y=${Math.round(startBtnBox.y)}` : "not found"}`,
      `Fields to fill before starting: title (pre-filled but useless), description (optional)`,
      "The import card competes for attention alongside the start-recording card",
    ];

    await audit({
      intent: "Quick — about to join a call, need to hit record",
      expectations:
        "One click to start, or fill a title and go. Title should be smart-defaulted.",
      observations,
      screenshotName: "ux-flow2-start-meeting",
    });
  });

  test('Flow 3: "I\'m recording — what\'s happening?"', async ({
    app,
    page,
    audit,
  }) => {
    // Start a recording
    await page.getByRole("button", { name: /Start recording/ }).click();
    await expect(page.getByText("Recording live").first()).toBeVisible();

    const counts = await app.countInteractiveElements();
    const cardCount = await app.countCards();

    const notesEditor = page.getByText("Live notes");
    const audioMeter = page.getByText("Capture health");
    const pipelineQueue = page.getByText("Processing queue");

    const observations: string[] = [
      `Interactive elements during recording: ${counts.total}`,
      `Cards visible during recording: ${cardCount}`,
      `Live notes editor visible: ${await notesEditor.isVisible()}`,
      `Audio meter card visible: ${await audioMeter.isVisible()}`,
      `Processing queue card visible (premature?): ${await pipelineQueue.isVisible()}`,
      'OBSERVATION: "Processing queue" card shows during recording but processing hasn\'t started yet — may create confusion about what happens when',
      "OBSERVATION: The right sidebar has two cards (Capture health + Processing queue) which could be combined or the queue could be deferred until stop",
    ];

    await audit({
      intent: "I want to see that recording is working and maybe take notes",
      expectations:
        "Clear recording indicator, elapsed time, notes area. Not too many distractions.",
      observations,
      elementCounts: counts,
      screenshotName: "ux-flow3-recording-active",
    });
  });

  test('Flow 4: "Recording stopped — what happened?"', async ({
    page,
    audit,
  }) => {
    // Start and stop recording
    await page.getByRole("button", { name: /Start recording/ }).click();
    await expect(page.getByText("Recording live").first()).toBeVisible();
    await page.getByRole("button", { name: /End meeting/ }).click();
    await page.getByRole("button", { name: "End meeting" }).last().click();

    // Now on meeting detail
    const analysisTab = page.getByRole("tab", { name: "Analysis" });
    const isAnalysisActive =
      (await analysisTab.getAttribute("data-state")) === "active";

    // Count action buttons visible at top
    const actionButtons = page.locator("main").getByRole("button");
    const actionButtonCount = await actionButtons.count();

    const observations: string[] = [
      `Analysis tab auto-selected: ${isAnalysisActive}`,
      `Total buttons visible on meeting detail: ${actionButtonCount}`,
      `GOOD: Analysis tab is correctly the default — most useful output first`,
      "OBSERVATION: Action bar has 4 buttons (Reprocess, Run prompt, Open folder, Delete) all at equal visual weight — Delete is a destructive action at the same level as Run prompt",
    ];

    await audit({
      intent:
        "I want to see my transcript and any AI analysis immediately",
      expectations:
        "Most useful output (analysis/summary) front and center, no hunting",
      observations,
      screenshotName: "ux-flow4-after-stop",
    });
  });

  test('Flow 5: "I want to review a past meeting"', async ({
    app,
    page,
    audit,
  }) => {
    await app.navigateTo("Meetings");
    await expect(page.getByText("Meetings on disk")).toBeVisible();

    const counts = await app.countInteractiveElements();
    const cardCount = await app.countCards();

    // Count checkboxes
    const checkboxCount = await page
      .locator('input[type="checkbox"]')
      .count();

    // Check if row whitespace is clickable — the rows have separate button cells
    const rowButtons = page.locator(
      ".divide-y button"
    );
    const rowButtonCount = await rowButtons.count();

    // Quick actions sidebar
    const quickActions = page.getByText("Import or batch-run");
    const quickActionsVisible = await quickActions.isVisible();

    const observations: string[] = [
      `Total interactive elements on meetings page: ${counts.total}`,
      `Cards visible: ${cardCount}`,
      `Checkboxes visible (one per meeting row): ${checkboxCount}`,
      `Individual button elements inside meeting rows: ${rowButtonCount}`,
      `Quick Actions sidebar card visible: ${quickActionsVisible}`,
      "ISSUE: Each meeting row has 4 separate button elements (title, date, duration, status) — the entire row should be one click target",
      "ISSUE: Checkboxes are always visible, creating bulk-action noise for the common case (just opening one meeting)",
      "ISSUE: Quick Actions sidebar is informational-only text — wastes a column for tips that could be inline",
      "ISSUE: Import button is duplicated here AND on home screen — unclear where the canonical import flow lives",
      "RECOMMENDATION: Make the entire row clickable. Move checkboxes behind an 'Edit/Select' mode. Remove the Quick Actions sidebar card.",
    ];

    await audit({
      intent: "Find a past meeting, read notes, maybe edit them",
      expectations:
        "A simple list I can scan quickly. Click a meeting, see the notes.",
      observations,
      elementCounts: counts,
      screenshotName: "ux-flow5-meetings-list",
    });
  });

  test('Flow 6: "I want to edit a meeting\'s notes"', async ({
    page,
    audit,
  }) => {
    // Navigate to completed meeting
    await page.getByText("Weekly planning").first().click();
    await page.getByRole("tab", { name: "Notes" }).click();

    const editBtn = page.getByRole("button", { name: "Edit notes" });
    const lockHeading = page.getByText(
      "Notes are locked for completed meetings"
    );

    const observations: string[] = [
      `Edit notes button visible: ${await editBtn.isVisible()}`,
      `"Notes are locked" heading visible: ${await lockHeading.isVisible()}`,
      'OBSERVATION: "Notes are locked for completed meetings" heading text is confusing — sounds like notes cannot be edited at all',
      'RECOMMENDATION: Softer language like "View mode" with "Edit" button, no lock metaphor',
    ];

    // Click edit and check editor state
    await editBtn.click();
    const saveBtn = page.getByRole("button", { name: "Save notes" });
    observations.push(`Save button visible after edit: ${await saveBtn.isVisible()}`);

    await audit({
      intent: "Open the notes tab and start typing",
      expectations:
        "One click to enter edit mode for completed meetings. Editor should feel comfortable.",
      observations,
      screenshotName: "ux-flow6-notes-editing",
    });
  });

  test('Flow 7: "I want to create or edit a prompt"', async ({
    app,
    page,
    audit,
  }) => {
    await app.navigateTo("Prompt Library");
    await expect(page.getByText("Prompt workspace")).toBeVisible();

    const counts = await app.countInteractiveElements();
    const cardCount = await app.countCards();

    // Check model visibility — is it behind an accordion?
    const modelSection = page.getByRole("switch", { name: "Auto-run" });
    const modelVisible = await modelSection.isVisible();

    // Check prompt body editor height
    const editorContainer = page.locator(".h-\\[420px\\]");
    const editorBox = await editorContainer.boundingBox();

    // Check accordion state
    const detailsAccordion = page.getByText(
      "Prompt details and file options"
    );
    const historyAccordion = page.getByText(
      "History, reset, and seeded prompt notes"
    );

    // Check if save button is visible without scrolling
    const saveBtn = page.getByRole("button", { name: "Save" });
    const saveBtnBox = await saveBtn.boundingBox();

    // Check sidebar prompt list for overflow
    const sidebarItems = page.locator(
      "button:has(.truncate)"
    );
    const sidebarItemCount = await sidebarItems.count();

    const observations: string[] = [
      `Total interactive elements: ${counts.total} (${counts.buttons} buttons, ${counts.inputs} inputs, ${counts.switches} switches)`,
      `Cards visible: ${cardCount}`,
      `Model selector visible without accordion: ${modelVisible}`,
      `Prompt body editor height: ${editorBox ? `${editorBox.height}px` : "not found"} (fixed 420px)`,
      `Save button position from top: ${saveBtnBox ? `${Math.round(saveBtnBox.y)}px` : "not found"}`,
      `Sidebar prompt items: ${sidebarItemCount}`,
      "ISSUE: Model selection is visible but tucked into a small area alongside the filename — not prominent enough for a key feature",
      `ISSUE: Two accordion sections add hidden depth — user must expand to find Prompt ID, Reset to Default`,
      `ISSUE: Prompt body editor is fixed at 420px height — gets squeezed on smaller screens while metadata takes more space`,
      `ISSUE: Sidebar prompt cards have inline auto-run switches + description text — too much information density per item`,
      `ISSUE: ${counts.buttons} buttons visible simultaneously creates decision paralysis — Save, Run against meeting, New prompt, Open in Finder, accordion triggers`,
      "RECOMMENDATION: Make prompt body editor the dominant element (60%+ of space). Surface model at top alongside title. Group secondary actions (reset, run against, file options) into a dropdown. Simplify sidebar items to name + badge only.",
    ];

    await audit({
      intent:
        "Open prompt library, find my prompt, change text, set model, save",
      expectations:
        "Prompt text editor dominates. Model selection obvious. Save is one click.",
      observations,
      elementCounts: counts,
      screenshotName: "ux-flow7-prompt-editor",
    });
  });

  test('Flow 8: "I want to change my default model or add an API key"', async ({
    app,
    page,
    audit,
  }) => {
    await app.navigateTo("Settings");

    const counts = await app.countInteractiveElements();
    const cardCount = await app.countCards();
    const nativeSelectCount = await page.locator("main select").count();

    const observations: string[] = [
      `Total interactive elements on settings: ${counts.total}`,
      `Cards visible: ${cardCount}`,
      `Native <select> elements (not shadcn): ${nativeSelectCount}`,
      "OBSERVATION: Settings page has 7 cards in a 2-column grid — a lot of visual weight",
      `ISSUE: ${nativeSelectCount} native <select> elements are visually inconsistent with shadcn components used elsewhere`,
      "OBSERVATION: LLM defaults card and API key section are well-grouped together — good",
      "OBSERVATION: Dependencies card spans full width at bottom — appropriate for diagnostics",
    ];

    await audit({
      intent: "Go to Settings, change model, paste API key",
      expectations:
        "Settings grouped logically. Find what I need without scrolling through everything.",
      observations,
      elementCounts: counts,
      screenshotName: "ux-flow8-settings",
    });
  });

  test('Flow 9: "I want to import a recording file"', async ({
    page,
    audit,
  }) => {
    // Check home screen import card
    const importCard = page.getByText("Bring in an existing meeting");
    const importCardVisible = await importCard.isVisible();

    // Check drag-drop affordance
    const importSection = page.getByText("Import recording");

    const observations: string[] = [
      `Import card visible on home screen: ${importCardVisible}`,
      `Import card badge "Import recording" visible: ${await importSection.isVisible()}`,
      'ISSUE: Import card says "Drop a Zoom export..." but the visual dashed border doesn\'t clearly indicate a drop zone',
      "ISSUE: Import also exists on the Meetings list page — two entry points creates confusion about where the canonical import flow lives",
      "RECOMMENDATION: Remove import card from home screen. Make Meetings list the single import entry point. Or collapse it to a small text link on home.",
    ];

    await audit({
      intent: "I have an mp4 from Zoom. I want to drop it in.",
      expectations:
        "Clear import target. Drag-and-drop visually signals where to drop.",
      observations,
      screenshotName: "ux-flow9-import",
    });
  });

  test('Flow 10: "First impression — does this feel polished?"', async ({
    app,
    page,
    audit,
  }) => {
    // Count card nesting per route
    const routeAudit: string[] = [];

    // Home
    const homeCards = await app.countCards();
    routeAudit.push(`Home: ${homeCards} cards`);

    // Meetings
    await app.navigateTo("Meetings");
    const meetingsCards = await app.countCards();
    routeAudit.push(`Meetings: ${meetingsCards} cards`);

    // Prompts
    await app.navigateTo("Prompt Library");
    const promptCards = await app.countCards();
    routeAudit.push(`Prompt Library: ${promptCards} cards`);

    // Settings
    await app.navigateTo("Settings");
    const settingsCards = await app.countCards();
    routeAudit.push(`Settings: ${settingsCards} cards`);

    // Count native selects across the app
    const nativeSelects = await page.locator("select").count();

    // Count custom rounded-[22px] elements
    const customRounded = await page
      .locator('[class*="rounded-[22px]"]')
      .count();

    // Go back to home for screenshot
    await app.navigateTo("Home");

    const observations: string[] = [
      "Card count per route:",
      ...routeAudit.map((r) => `  ${r}`),
      `Native <select> elements on Settings page: ${nativeSelects}`,
      `Custom rounded-[22px] elements on Settings: ${customRounded}`,
      "ISSUE: Card-heavy design — every section wrapped in a Card creates uniform visual weight with no hierarchy",
      "ISSUE: Wizard and Logs views use plain HTML (not shadcn) — visual inconsistency with the rest of the app",
      `ISSUE: Mix of native <select> and shadcn components — ${nativeSelects} native selects should be replaced with shadcn Select for consistency`,
      "ISSUE: Custom rounded-[22px] rounding used alongside Tailwind standard rounded-2xl — inconsistent",
      "RECOMMENDATION: Reduce card usage to meaningful containers only. Use flat sections with dividers for settings/forms. Standardize on shadcn Select. Replace wizard plain HTML with shadcn components.",
    ];

    await audit({
      intent: "First impression — does this look like a daily-driver tool?",
      expectations:
        "Consistent visual language, appropriate whitespace, not too much going on",
      observations,
      screenshotName: "ux-flow10-first-impression",
    });
  });

  test("Accessibility: switches have aria-labels", async ({ page, app }) => {
    // Check home
    // Navigate to settings which has switches
    await app.navigateTo("Settings");
    const switches = page.getByRole("switch");
    const switchCount = await switches.count();

    for (let i = 0; i < switchCount; i++) {
      const ariaLabel = await switches.nth(i).getAttribute("aria-label");
      expect(ariaLabel, `Switch ${i} should have aria-label`).toBeTruthy();
    }
  });

  test("Accessibility: dialogs have correct role", async ({ app, page }) => {
    // Open the new meeting modal to verify dialog role
    await app.emitAppAction("open-new-meeting");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });

  test("Form validation: buttons disabled when fields empty", async ({
    app,
    page,
  }) => {
    await app.navigateTo("Prompt Library");
    await page.getByRole("button", { name: "New prompt" }).click();

    const createBtn = page
      .getByRole("dialog")
      .getByRole("button", { name: "Create prompt" });
    await expect(createBtn).toBeDisabled();

    // Fill just one field — should still be disabled
    await page.locator("#new-prompt-id").fill("test");
    await expect(createBtn).toBeDisabled();

    // Fill all required fields
    await page.locator("#new-prompt-label").fill("Test");
    await page.locator("#new-prompt-filename").fill("test.md");
    await expect(createBtn).toBeEnabled();
  });

  test("Modal dismiss: all dialogs can be cancelled", async ({
    app,
    page,
  }) => {
    // New meeting modal
    await app.emitAppAction("open-new-meeting");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();

    // Navigate to meeting detail for more modals
    await page.getByText("Weekly planning").click();

    // Reprocess modal
    await page.getByRole("button", { name: "Reprocess" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();

    // Run prompt modal
    await page.getByRole("button", { name: "Run prompt" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });
});
