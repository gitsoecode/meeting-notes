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
    return this.main.locator("h2").first();
  }

  statusBadge() {
    return this.main.locator("[data-slot='badge']").first();
  }

  // Tabs
  tab(name: "Summary" | "Analysis" | "Notes" | "Transcript" | "Recording" | "Metadata") {
    return this.page.getByRole("tab", { name });
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
    return this.main.getByRole("button", { name: "Refresh summary" });
  }

  editSummaryPromptButton() {
    return this.main.getByRole("button", { name: "Edit summary prompt" });
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
    return this.main.getByText("View mode");
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
    return this.main.getByRole("button", { name: "Reprocess" });
  }

  runPromptButton() {
    return this.main.getByRole("button", { name: "Run prompt" });
  }

  moreActionsButton() {
    return this.main.locator("svg.lucide-more-horizontal").locator("xpath=ancestor::button[1]");
  }

  openFolderButton() {
    return this.page.getByRole("menuitem", { name: "Open folder" });
  }

  deleteButton() {
    return this.page.getByRole("menuitem", { name: "Delete meeting" });
  }

  // Processing state
  processingCard() {
    return this.main.getByText("Processing locally with");
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
    return this.main.getByText("Run details");
  }
}
