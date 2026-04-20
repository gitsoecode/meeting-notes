import { defineConfig } from "@playwright/test";

/**
 * Separate Playwright config for **live Electron** specs that drive the
 * actual packaged main process (not the Vite dev server) and talk to the
 * user's real Gistlist library + Ollama daemon. Acceptance-blocking
 * for the chat assistant: proves the retrieval → synthesis → cite → seek
 * loop works against real data.
 *
 * Run with: `npm run test:e2e:electron --workspace @gistlist/app`
 */
export default defineConfig({
  testDir: "./playwright/electron-live",
  testMatch: ["**/*.spec.ts"],
  // Real Ollama calls with an 8B model can easily take 30–60s per turn.
  timeout: 300_000,
  // Can't parallelize: a single Electron instance + a single DB.
  workers: 1,
  fullyParallel: false,
  use: {
    screenshot: "on",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  reporter: [["list"]],
});
