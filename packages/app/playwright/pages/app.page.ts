import type { Locator, Page } from "@playwright/test";

export class AppPage {
  readonly page: Page;
  readonly sidebar: Locator;
  readonly header: Locator;

  constructor(page: Page) {
    this.page = page;
    this.sidebar = page.locator("aside");
    this.header = page.locator("header");
  }

  navButton(label: "Home" | "Meetings" | "Prompt Library" | "Activity") {
    return this.sidebar.getByRole("button", { name: label });
  }

  settingsButton() {
    return this.sidebar.getByRole("button", { name: "Settings" });
  }

  mobileNavButton(label: string) {
    return this.header.getByRole("button", { name: label });
  }

  routeHeading() {
    return this.header.locator("h1");
  }

  routeLabel() {
    return this.header.locator(
      ".text-xs.font-semibold.uppercase"
    );
  }

  recordingBadge() {
    return this.header.getByText("Recording");
  }

  sidebarRecordingDot() {
    return this.sidebar.locator(".bg-\\[var\\(--recording\\)\\]");
  }

  sidebarTrigger() {
    return this.page.getByRole("button", { name: "Close navigation" }).or(
      this.page.locator("header button").first()
    );
  }

  async navigateTo(
    route: "Home" | "Meetings" | "Prompt Library" | "Activity" | "Settings"
  ) {
    // At narrow viewports, sidebar is off-screen; open it via trigger
    const isNarrow = (this.page.viewportSize()?.width ?? 1440) < 768;
    if (isNarrow) {
      // First close sidebar if it's already open
      const backdrop = this.page.getByRole("button", {
        name: "Close navigation",
      });
      if (await backdrop.isVisible()) {
        await backdrop.click();
        await this.page.waitForTimeout(300);
      }
      // Now open the sidebar fresh
      const trigger = this.page.locator("header button").first();
      await trigger.click();
      await this.page.waitForTimeout(300);
    }
    if (route === "Settings") {
      await this.settingsButton().click();
    } else {
      await this.navButton(route).click();
    }
    await this.waitForRoute(route);
    if (isNarrow) {
      // Wait for navigation then close the overlay if still open
      await this.page.waitForTimeout(200);
      const backdrop = this.page.getByRole("button", {
        name: "Close navigation",
      });
      if (await backdrop.isVisible()) {
        await backdrop.click();
        await this.page.waitForTimeout(300);
      }
    }
  }

  async waitForRoute(
    route: "Home" | "Meetings" | "Prompt Library" | "Activity" | "Settings",
    options?: { timeout?: number }
  ) {
    const timeout = options?.timeout;
    await this.routeHeading().filter({ hasText: route }).waitFor({ timeout });
    if (route === "Home") {
      await this.page.getByRole("heading", { name: "New meeting" }).waitFor({ timeout });
    }
    if (route === "Meetings") {
      await this.page.getByPlaceholder("Search meetings…").waitFor({ timeout });
    }
    if (route === "Prompt Library") {
      await this.page.locator("#prompt-title").waitFor({ timeout });
    }
    if (route === "Activity") {
      await this.page.getByRole("heading", { name: "Jobs" }).waitFor({ timeout });
    }
    if (route === "Settings") {
      await this.page.getByText("Changes take effect immediately.").waitFor({ timeout });
    }
  }

  async bootstrapHome() {
    await this.page.goto("/", { waitUntil: "domcontentloaded" });
    try {
      await this.waitForRoute("Home", { timeout: 15000 });
    } catch {
      await this.page.reload({ waitUntil: "domcontentloaded" });
      await this.waitForRoute("Home", { timeout: 15000 });
    }
  }

  async emitAppAction(
    type: "open-new-meeting" | "toggle-recording",
    source: "tray" | "shortcut" = "tray"
  ) {
    await this.page.evaluate(
      ([t, s]) => {
        (window as any).__MEETING_NOTES_TEST.emitAppAction(t, s);
      },
      [type, source] as const
    );
  }

  async navigateRoute(route: {
    name: "record" | "meetings" | "meeting" | "prompts" | "settings" | "activity";
    runFolder?: string;
    promptId?: string;
  }) {
    await this.page.evaluate((nextRoute) => {
      (window as any).__MEETING_NOTES_TEST.navigateRoute(nextRoute);
    }, route);
  }

  async resetMockState() {
    await this.page.evaluate(() => {
      (window as any).__MEETING_NOTES_TEST.resetState();
    });
  }

  async removeRunFolder(runFolder: string) {
    await this.page.evaluate((targetRunFolder) => {
      (window as any).__MEETING_NOTES_TEST.removeRunFolder(targetRunFolder);
    }, runFolder);
  }

  async removeAttachmentDirectory(runFolder: string) {
    await this.page.evaluate((targetRunFolder) => {
      (window as any).__MEETING_NOTES_TEST.removeAttachmentDirectory(targetRunFolder);
    }, runFolder);
  }

  async removeDocument(runFolder: string, fileName: string) {
    await this.page.evaluate(
      ([targetRunFolder, targetFileName]) => {
        (window as any).__MEETING_NOTES_TEST.removeDocument(targetRunFolder, targetFileName);
      },
      [runFolder, fileName] as const
    );
  }

  async failPromptOutput(runFolder: string, promptId: string, error?: string) {
    await this.page.evaluate(
      ([targetRunFolder, targetPromptId, message]) => {
        (window as any).__MEETING_NOTES_TEST.failPromptOutput(
          targetRunFolder,
          targetPromptId,
          message
        );
      },
      [runFolder, promptId, error] as const
    );
  }

  async countInteractiveElements(scope?: Locator) {
    const root = scope ?? this.page.locator("main");
    const buttons = await root.getByRole("button").count();
    const inputs = await root.locator("input").count();
    const selects = await root.locator("select").count();
    const switches = await root.getByRole("switch").count();
    const links = await root.getByRole("link").count();
    return { buttons, inputs, selects, switches, links, total: buttons + inputs + selects + switches + links };
  }

  async countCards() {
    return this.page.locator("main [data-slot='card']").count();
  }
}
