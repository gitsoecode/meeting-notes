import type { Locator, Page } from "@playwright/test";

export class MeetingDetailPage {
  readonly page: Page;
  readonly main: Locator;

  constructor(page: Page) {
    this.page = page;
    this.main = page.locator("main");
  }

  backButton() {
    return this.main.getByRole("button", { name: "Back to meetings" });
  }

  meetingTitle() {
    return this.page.locator("header h1");
  }

  statusBadge() {
    return this.main.locator("[data-slot='badge']").first();
  }

  // Tabs
  tab(name: "Metadata" | "Prep" | "Notes" | "Summary" | "Analysis" | "Transcript" | "Recording" | "Files") {
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

  // Notes tab
  editNotesButton() {
    return this.main.getByRole("button", { name: "Edit" });
  }

  saveNotesButton() {
    return this.main.getByRole("button", { name: "Save notes" });
  }

  notesCancelButton() {
    // In notes edit mode, Cancel is alongside Save
    return this.main.getByRole("button", { name: "Cancel" });
  }

  notesReadModeHeading() {
    return this.main.getByText("Editing notes").or(this.main.getByText("No notes for this meeting."));
  }

  notesEditor() {
    return this.main.locator(".cm-content, .milkdown");
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

  focusRecordingButton() {
    return this.main.getByRole("button", { name: /Focus on recording/i });
  }

  fullWorkspaceButton() {
    return this.main.getByRole("button", { name: /View full workspace/i });
  }

  prepLockButton() {
    return this.main.getByRole("button", { name: /Unlock editing|Lock editing/ }).first();
  }

  async waitForReady() {
    await this.page.locator("header h1").filter({ hasText: "Meeting workspace" }).waitFor();
    await this.backButton().waitFor();
    await this.page.getByRole("tablist").waitFor();
  }
}
