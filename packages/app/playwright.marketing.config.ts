import { defineConfig } from "@playwright/test";

// Standalone Playwright config for the marketing screenshot capture. Not part
// of the regular e2e suite — invoked manually via `npm run capture:marketing`
// to regenerate the marketing-site assets in `gistlist/web/public/assets/`.
export default defineConfig({
  testDir: "./playwright/marketing",
  testMatch: ["**/*.spec.ts"],
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
