import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./playwright",
  testMatch: ["**/*.spec.ts"],
  timeout: 30000,
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
