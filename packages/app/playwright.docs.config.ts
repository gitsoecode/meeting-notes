import { defineConfig } from "@playwright/test";

// Standalone Playwright config for the docs-site screenshot capture. Sibling
// of playwright.marketing.config.ts. Not part of the regular e2e suite —
// invoked manually via `npm run capture:docs` to regenerate the docs assets
// in `gistlist/web/public/docs/screenshots/`.
export default defineConfig({
  testDir: "./playwright/marketing",
  testMatch: ["capture.docs.spec.ts"],
  timeout: 60_000,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
    screenshot: "off",
    trace: "off",
  },
  reporter: [["list"]],
  webServer: {
    command: "npm run preview:renderer",
    port: 4173,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
