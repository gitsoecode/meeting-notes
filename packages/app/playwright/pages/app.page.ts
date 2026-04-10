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
