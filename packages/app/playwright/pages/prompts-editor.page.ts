import type { Locator, Page } from "@playwright/test";

export class PromptsEditorPage {
  readonly page: Page;
  readonly main: Locator;

  constructor(page: Page) {
    this.page = page;
    this.main = page.locator("main");
  }

  libraryHeading() {
    return this.main.getByRole("heading", { name: "Library" });
  }

  promptSidebarItem(label: string) {
    return this.main.getByRole("button").filter({ hasText: label }).first();
  }

  rootPromptItem() {
    return this.main.getByTestId("prompt-root-item");
  }

  preloadedPromptsGroup() {
    return this.main.getByTestId("prompt-category-pre-loaded");
  }

  categoryGroup(name: string) {
    return this.main.getByTestId(`prompt-category-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`);
  }

  customPromptsGroup() {
    return this.main.getByTestId("prompt-custom-group");
  }

  customPromptItem(label: string) {
    return this.customPromptsGroup().getByRole("button").filter({ hasText: label }).first();
  }

  titleInput() {
    return this.main.locator("#prompt-title");
  }

  filenameInput() {
    return this.main.locator("#prompt-output-filename");
  }

  descriptionInput() {
    return this.main.locator("#prompt-description");
  }

  promptBodyEditor() {
    return this.main.locator(".cm-content, .milkdown").first();
  }

  editorShell() {
    return this.main.locator(".flex.flex-1.flex-col.bg-white").first();
  }

  activeAutoRunSwitch() {
    return this.main.getByRole("switch", { name: "Auto-run" });
  }

  modelCombobox() {
    return this.main.getByRole("combobox").first();
  }

  saveButton() {
    return this.main.getByRole("button", { name: "Save changes" });
  }

  moreButton() {
    return this.main.getByRole("button", { name: "Prompt actions" });
  }

  newPromptButton() {
    return this.main.getByRole("button", { name: "Create prompt" }).first();
  }

  runAgainstMeetingItem() {
    return this.page.getByRole("menuitem", { name: "Run against meeting" });
  }

  resetToDefaultItem() {
    return this.page.getByRole("menuitem", { name: "Reset to default" });
  }

  detailsAccordion() {
    return this.main.getByRole("button", { name: "Details" });
  }

  newPromptDialog() {
    return this.page.getByRole("dialog");
  }

  newPromptIdInput() {
    return this.page.locator("#new-prompt-id");
  }

  newPromptLabelInput() {
    return this.page.locator("#new-prompt-label");
  }

  newPromptFilenameInput() {
    return this.page.locator("#new-prompt-fn");
  }

  newPromptBodyTextarea() {
    return this.page.locator("#new-prompt-body");
  }

  createPromptButton() {
    return this.page.getByRole("dialog").getByRole("button", { name: "Create" });
  }

  runAgainstModalHeading() {
    return this.page.getByRole("heading", { name: /Run ".+"/ });
  }

  runAgainstModalCancel() {
    return this.page.getByRole("dialog").getByRole("button", { name: "Cancel" });
  }

  finderButton() {
    return this.main.getByRole("button", { name: "Open in Finder" });
  }

  runAgainstMeetingSearchInput() {
    return this.page.getByRole("dialog").getByPlaceholder("Search meetings");
  }

  showAllMeetingsButton() {
    return this.page.getByRole("dialog").getByRole("button", { name: /Show all|Show fewer/ });
  }

  runAgainstMeetingRunButton() {
    return this.page.getByRole("dialog").getByRole("button", { name: /Run on/ });
  }
}
