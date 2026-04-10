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

  startButton() {
    return this.main.getByRole("button", { name: /Start recording/ });
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
    return this.page.locator("label", { hasText: "Save recording without processing" });
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

  recordingLiveBadge() {
    return this.main.getByText("Recording live").first();
  }

  elapsedTimer() {
    return this.main.getByText(/\d+:\d{2}/);
  }

  newRecordingBadge() {
    return this.main.getByText("New recording");
  }

  importRecordingBadge() {
    return this.main.getByText("import a recording", { exact: false });
  }

  audioMeterCard() {
    return this.main.getByText("Capture health");
  }

  pipelineStatusCard() {
    return this.main.getByText("What happens next");
  }

  liveNotesEditor() {
    return this.main.getByText("Live notes");
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
  }
}
