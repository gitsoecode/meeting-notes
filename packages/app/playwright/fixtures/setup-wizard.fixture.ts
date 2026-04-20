import { test as base, expect } from "@playwright/test";
import { installMockApi } from "../mock-api";
import { SetupWizardPage } from "../pages/setup-wizard.page";

type WizardFixtures = {
  wizard: SetupWizardPage;
};

export const test = base.extend<WizardFixtures>({
  wizard: async ({ page }, use) => {
    await installMockApi(page);
    // Override config.get to return null on first call (triggers wizard)
    // Also override secrets.has to return false (fresh install — no keys yet)
    await page.addInitScript(() => {
      const originalGet = (window as any).api.config.get;
      let firstCall = true;
      (window as any).api.config.get = async function () {
        if (firstCall) {
          firstCall = false;
          return null;
        }
        return originalGet.call(this);
      };
      (window as any).api.secrets.has = async function () {
        return false;
      };
    });
    await page.goto("/");
    await expect(page.getByText("Gistlist setup")).toBeVisible();
    await use(new SetupWizardPage(page));
  },
});

export { expect } from "@playwright/test";
