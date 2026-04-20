import { test, expect } from "../fixtures/base.fixture";
import type { Page } from "@playwright/test";

const RUN_FOLDER = "/runs/weekly-planning";

async function readNotesFromDisk(page: Page): Promise<string> {
  return page.evaluate(async (folder) => {
    // @ts-expect-error - injected by preload
    return await window.api.runs.readDocument(folder, "notes.md");
  }, RUN_FOLDER);
}

test.describe("Notes autosave — deletions persist across view toggles", () => {
  test.beforeEach(async ({ app, meetingsList, meetingWorkspace }) => {
    await app.navigateTo("Meetings");
    await meetingsList.waitForReady();
    await meetingsList.meetingRow("Weekly planning").click();
    // Land on Details first so the default-view resolution has a chance to
    // run before we toggle to Workspace ourselves.
    await meetingWorkspace.waitForReady({ view: "details" });
    await meetingWorkspace.viewToggle("Workspace").click();
    await expect(meetingWorkspace.workspacePanelGroup()).toBeVisible();
  });

  test("typing + deleting lines is preserved after flipping Details↔Workspace", async ({
    meetingWorkspace,
    page,
  }) => {
    const editor = meetingWorkspace.notesEditor();
    await expect(editor).toBeVisible();

    // Click to focus the contenteditable, then type into it. Click near the
    // bottom of the editor rect so the cursor lands near end-of-doc without
    // fighting ProseMirror's selection model.
    const box = await editor.boundingBox();
    if (!box) throw new Error("notes editor has no bounding box");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 10);
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Alpha", { delay: 10 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("Bravo", { delay: 10 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("Charlie", { delay: 10 });

    // Let the 150ms autosave debounce settle.
    await page.waitForTimeout(500);

    // Baseline sanity: editor shows all three, and they reached disk.
    await expect(editor).toContainText("Alpha");
    await expect(editor).toContainText("Bravo");
    await expect(editor).toContainText("Charlie");
    {
      const onDisk = await readNotesFromDisk(page);
      expect(onDisk).toContain("Alpha");
      expect(onDisk).toContain("Bravo");
      expect(onDisk).toContain("Charlie");
    }

    // Delete the last two lines ("Charlie" + "Bravo"). Cursor is at
    // end-of-doc from the typing above. 14 backspaces is enough to eat
    // "Charlie" (7 chars) + paragraph join + "Bravo" (5) + paragraph join
    // without biting into "Alpha".
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(20);
    }

    await page.waitForTimeout(600);

    // Capture the post-deletion state: this is the ground truth the view
    // toggle must preserve.
    const preToggleEditor = await editor.innerText();
    const preToggleDisk = await readNotesFromDisk(page);
    expect(preToggleEditor).not.toContain("Charlie");
    expect(preToggleEditor).not.toContain("Bravo");
    expect(preToggleEditor).toContain("Alpha");
    expect(preToggleDisk).not.toContain("Charlie");
    expect(preToggleDisk).not.toContain("Bravo");
    expect(preToggleDisk).toContain("Alpha");

    // The reported repro: flip to Details and back. The deletion must stick
    // in both the editor and on disk.
    await meetingWorkspace.viewToggle("Details").click();
    await expect(meetingWorkspace.tabsList()).toBeVisible();
    await meetingWorkspace.viewToggle("Workspace").click();
    await expect(meetingWorkspace.workspacePanelGroup()).toBeVisible();

    const refetched = meetingWorkspace.notesEditor();
    await expect(refetched).toBeVisible();
    const postToggleEditor = await refetched.innerText();
    const postToggleDisk = await readNotesFromDisk(page);
    expect(postToggleEditor).not.toContain("Charlie");
    expect(postToggleEditor).not.toContain("Bravo");
    expect(postToggleEditor).toContain("Alpha");
    expect(postToggleDisk).not.toContain("Charlie");
    expect(postToggleDisk).not.toContain("Bravo");
    expect(postToggleDisk).toContain("Alpha");
  });

  test("fast flip to Details immediately after deletion still persists the deletion", async ({
    meetingWorkspace,
    page,
  }) => {
    const editor = meetingWorkspace.notesEditor();
    const box = await editor.boundingBox();
    if (!box) throw new Error("notes editor has no bounding box");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 10);
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Alpha", { delay: 10 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("Bravo", { delay: 10 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("Charlie", { delay: 10 });

    // Let baseline typing land on disk.
    await page.waitForTimeout(300);

    // Delete last two lines then flip *immediately* — no debounce grace
    // after the last keystroke. Space keystrokes slightly so each one
    // produces its own markdownUpdated transaction before the next lands.
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(20);
    }

    await meetingWorkspace.viewToggle("Details").click();
    await expect(meetingWorkspace.tabsList()).toBeVisible();
    await meetingWorkspace.viewToggle("Workspace").click();
    await expect(meetingWorkspace.workspacePanelGroup()).toBeVisible();

    const refetched = meetingWorkspace.notesEditor();
    await expect(refetched).toBeVisible();
    const postToggleEditor = await refetched.innerText();
    const postToggleDisk = await readNotesFromDisk(page);
    expect(postToggleEditor).not.toContain("Charlie");
    expect(postToggleEditor).not.toContain("Bravo");
    expect(postToggleEditor).toContain("Alpha");
    expect(postToggleDisk).not.toContain("Charlie");
    expect(postToggleDisk).not.toContain("Bravo");
    expect(postToggleDisk).toContain("Alpha");
  });
});
