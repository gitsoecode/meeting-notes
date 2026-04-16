import type { Locator, Page } from "@playwright/test";

export type MeetingView = "Workspace" | "Details";

export class MeetingWorkspacePage {
  readonly page: Page;
  readonly main: Locator;

  constructor(page: Page) {
    this.page = page;
    this.main = page.locator("main");
  }

  backButton() {
    // After the header refactor, the back control lives in the global site
    // header (ArrowLeft with aria-label "Go back"), not in the meeting shell.
    return this.page.locator("header").getByRole("button", { name: "Go back" });
  }

  meetingTitle() {
    return this.page.locator("header h1");
  }

  statusBadge() {
    return this.main.locator("[data-slot='badge']").first();
  }

  // View toggle (Workspace | Details segmented control)
  viewToggle(which: MeetingView) {
    return this.main.getByRole("radio", { name: which });
  }

  // Link in Details view that flips back to Workspace
  editInWorkspaceLink() {
    return this.main.getByRole("button", { name: /Edit prep and notes in Workspace view/ });
  }

  // Tabs (Details view only)
  tab(name: "Metadata" | "Summary" | "Analysis" | "Transcript" | "Recording" | "Files") {
    return this.main.locator('[role="tab"]:visible').filter({ hasText: name }).first();
  }

  tabsList() {
    return this.page.getByRole("tablist");
  }

  allTabs() {
    return this.page.getByRole("tab");
  }

  summaryContent() {
    return this.main.locator(".markdown-view");
  }

  refreshSummaryButton() {
    return this.main.getByRole("button", { name: /Refresh/ });
  }

  editSummaryPromptButton() {
    return this.main.getByRole("button", { name: /Edit prompt/ });
  }

  // Analysis tab
  promptSidebarItem(label: string) {
    return this.main.getByRole("button", { name: label });
  }

  promptOutputContent() {
    return this.main.locator(".markdown-view");
  }

  noAnalysisMessage() {
    return this.main.getByText("No analysis prompts yet");
  }

  // Workspace split-pane helpers. The panel primitives don't expose a
  // distinctive attribute by default, so match by the resize handle and the
  // pane-header labels rendered above each editor.
  workspacePanelGroup() {
    return this.main.locator('[data-group]').first();
  }

  workspacePrepLabel() {
    return this.main.getByText("Prep", { exact: true });
  }

  // Transcript tab
  transcriptContent() {
    return this.main.locator("main").getByText("Welcome everyone.");
  }

  // Recording tab
  recordingCard(name: string) {
    return this.main.getByText(name);
  }

  downloadRecordingButton() {
    return this.main.getByRole("button", { name: "Download" }).first();
  }

  deleteRecordingButton() {
    return this.main.getByRole("button", { name: "Delete" }).first();
  }

  deleteRecordingDialogTitle() {
    return this.page.getByRole("heading", { name: "Delete recording?" });
  }

  // Action buttons
  reprocessButton() {
    return this.page.getByRole("menuitem", { name: "Reprocess" });
  }

  runPromptButton() {
    return this.main.getByRole("button", { name: "Run prompt", exact: true });
  }

  moreActionsButton() {
    return this.main
      .getByRole("button", { name: "Launch chat" })
      .locator("..")
      .getByRole("button")
      .last();
  }

  openFolderButton() {
    return this.page.getByRole("menuitem", { name: "Open folder" });
  }

  deleteButton() {
    return this.page.getByRole("menuitem", { name: "Delete meeting" });
  }

  // Processing state
  processingCard() {
    return this.main.getByText("Processing");
  }

  // Reprocess modal
  reprocessModalHeading() {
    return this.page.getByRole("heading", { name: "Reprocess meeting" });
  }

  reprocessScopeButton(name: string) {
    return this.page.getByRole("dialog").getByRole("button", { name });
  }

  reprocessScopeSelect() {
    return this.page.getByRole("dialog").getByRole("combobox");
  }

  reprocessPromptOption(label: string) {
    return this.page.getByRole("dialog").getByText(label);
  }

  // Shared modal buttons
  modalRunButton() {
    return this.page.getByRole("dialog").getByRole("button", { name: /^(Run|Start run|Start reprocess)$/ });
  }

  modalCancelButton() {
    return this.page.getByRole("dialog").getByRole("button", { name: "Cancel" });
  }

  // Obsidian button
  obsidianButton() {
    return this.main.getByRole("button", { name: "Open in Obsidian" });
  }

  // Metadata tab
  metadataHeading() {
    return this.main.getByRole("heading", { name: "Meeting metadata" });
  }

  metadataDescriptionText() {
    return this.main
      .getByText("Description", { exact: true })
      .locator("xpath=following-sibling::div[1]")
      .first();
  }

  metadataDescriptionTextarea() {
    return this.main.locator('textarea[placeholder="What was this meeting about?"]').first();
  }

  metadataSaveButton() {
    return this.main.getByRole("button", { name: /^Save$/ }).first();
  }

  metadataCancelButton() {
    return this.main.getByRole("button", { name: "Cancel" }).first();
  }

  continueRecordingButton() {
    return this.main.getByRole("button", { name: "Continue recording" });
  }

  editAsDraftItem() {
    return this.page.getByRole("menuitem", { name: "Edit as draft" });
  }

  friendlyError() {
    return this.main.getByText("This meeting no longer exists on disk.");
  }

  /**
   * Waits for the meeting route to finish its initial data load. Pass the
   * view you expect to land on: "details" (the default for completed/error
   * meetings) waits for the tablist, "workspace" (drafts and live) waits for
   * the resize panel group.
   */
  async waitForReady(opts: { view?: "workspace" | "details" } = {}) {
    await this.page.locator("header h1").filter({ hasText: "Meeting" }).waitFor();
    // Meeting-specific signal: the Workspace|Details toggle is only rendered
    // on the meeting route.
    await this.viewToggle("Workspace").waitFor();
    const view = opts.view ?? "details";
    if (view === "details") {
      await this.page.getByRole("tablist").waitFor();
    } else {
      await this.workspacePanelGroup().waitFor();
    }
  }
}
