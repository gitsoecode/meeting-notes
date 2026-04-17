import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./playwright",
  testMatch: ["**/*.spec.ts"],
  // Mock-backed specs should never need this long. 10s is enough for real
  // network-free flows; keep failures fast so the iteration loop stays tight.
  timeout: 10000,
  // Parallelize locally; serialize on CI to avoid flaky fixture contention.
  workers: process.env.CI ? 1 : 4,
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
    screenshot: "on",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: "narrow",
      use: { viewport: { width: 640, height: 900 } },
      testMatch: ["**/navigation.spec.ts", "**/ux-audit.spec.ts"],
    },
  ],
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ["./playwright/reporters/findings-reporter.ts"],
  ],
  webServer: {
    command: "npm run preview:renderer",
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
