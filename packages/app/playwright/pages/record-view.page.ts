import type { Locator, Page } from "@playwright/test";

export class RecordViewPage {
  readonly page: Page;
  readonly main: Locator;

  constructor(page: Page) {
    this.page = page;
    this.main = page.locator("main");
  }

  titleInput() {
    return this.main.getByPlaceholder("Untitled Meeting");
  }

  descriptionTextarea() {
    return this.main.getByPlaceholder("What's this meeting about?");
  }

  prepareForLaterButton() {
    return this.main.getByRole("button", { name: /Prepare for later/ });
  }

  startButton() {
    return this.main.getByRole("button", { name: /Start recording/ });
  }

  pauseButton() {
    return this.main.getByRole("button", { name: /Pause/ });
  }

  resumeButton() {
    return this.main.getByRole("button", { name: /Resume/ });
  }

  endMeetingButton() {
    return this.main.getByRole("button", { name: /End meeting/ });
  }

  endMeetingDialogTitle() {
    return this.page.getByRole("heading", { name: "End meeting" });
  }

  deleteDialogTitle() {
    return this.page.getByRole("heading", { name: "Delete meeting?" });
  }

  keepRecordingButton() {
    return this.page.getByRole("button", { name: "Keep recording" });
  }

  confirmDeleteButton() {
    return this.page.getByRole("button", { name: "Delete meeting" }).last();
  }

  processMeetingOption() {
    return this.page.locator("label", { hasText: "Process meeting" });
  }

  saveMeetingOption() {
    return this.page.locator("label", { hasText: "Save without processing" });
  }

  deleteMeetingOption() {
    return this.page.locator("label", { hasText: /^Delete meeting/ });
  }

  transcribeCheckbox() {
    return this.page.getByRole("checkbox", { name: "Transcribe" });
  }

  summaryCheckbox() {
    return this.page.getByRole("checkbox", { name: /Summary \+ Action Items|Summary/ });
  }

  confirmEndMeetingButton() {
    return this.page.getByRole("button", { name: "End meeting" }).last();
  }

  saveMeetingButton() {
    return this.page.getByRole("button", { name: "Save meeting" }).last();
  }

  reviewDeleteButton() {
    return this.page.getByRole("button", { name: "Review delete" }).last();
  }

  importButton() {
    return this.main.getByRole("button", { name: /import a recording/i });
  }

  viewAllMeetingsButton() {
    return this.main.getByRole("button", { name: /View all meetings/i });
  }

  recordingLiveBadge() {
    // Recording indicator now lives in the global site header pill, which
    // persists across routes so users can jump back to the active meeting.
    return this.page.locator("header").getByText(/Recording · \d+:\d{2}:\d{2}/).first();
  }

  elapsedTimer() {
    return this.page.locator("header").getByText(/Recording · \d+:\d{2}:\d{2}/).first();
  }

  newRecordingBadge() {
    return this.main.getByRole("heading", { name: "New meeting" });
  }

  importRecordingBadge() {
    return this.main.getByRole("button", { name: /import a recording/i });
  }

  audioMeterCard() {
    // The LiveChannelMeters component renders a meter with aria-label
    // "Microphone input level"; it's the same icon-only presentation the
    // meeting workspace uses for the live capture health strip.
    return this.main.getByLabel("Microphone input level");
  }

  pipelineStatusCard() {
    return this.main.getByText("Coming up");
  }

  draftTab(name: "Prep" | "Notes" | "Analysis" | "Files") {
    return this.main.locator('[role="tab"]:visible').filter({ hasText: name }).first();
  }

  addAttachmentButton() {
    return this.page.getByRole("button", { name: /Add file/ });
  }

  liveNotesEditor() {
    return this.main.getByRole("textbox").first();
  }

  errorMessage() {
    return this.main.locator(".text-\\[var\\(--error\\)\\]");
  }

  async startRecording(title?: string) {
    if (title) {
      await this.titleInput().clear();
      await this.titleInput().fill(title);
    }
    await this.startButton().click();
    await this.endMeetingButton().waitFor();
  }

  async waitForHomeReady() {
    await this.page.getByRole("heading", { name: "New meeting" }).waitFor();
    await this.startButton().waitFor();
  }
}
