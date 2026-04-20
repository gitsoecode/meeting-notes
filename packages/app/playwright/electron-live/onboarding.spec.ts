/**
 * Live Electron walkthrough of the setup wizard. No mocks — boots the
 * compiled main process against a throwaway HOME so the wizard appears.
 *
 * The job here is regression cover for the kind of bug that took down the
 * Dependencies step (an undefined identifier that the mocked spec missed
 * because it never reached step 4): every step is rendered, we listen for
 * uncaught renderer errors, and we fail if the screen-level error boundary
 * is ever shown.
 *
 * Prereqs:
 *   - `npm run build --workspace @gistlist/app` (produces dist/main/index.js).
 *
 * Run: `npm run test:e2e:electron --workspace @gistlist/app -- onboarding`
 */
import { _electron as electron, expect, test } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const APP_ROOT = path.resolve(__dirname, "../..");
const MAIN_ENTRY = path.join(APP_ROOT, "dist/main/index.js");

let app: ElectronApplication;
let window: Page;
let tempHome: string;
const rendererErrors: string[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  if (!fs.existsSync(MAIN_ENTRY)) {
    throw new Error(
      `Electron main entry not built at ${MAIN_ENTRY}. Run 'npm run build --workspace @gistlist/app' first.`,
    );
  }

  // Throwaway HOME so the wizard appears (no ~/.gistlist/config.yaml yet)
  // and so finishing setup couldn't accidentally clobber the dev user's
  // real data dir even if the test reaches that point.
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "gistlist-onboarding-"));

  const electronBinary = path.join(
    REPO_ROOT,
    "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
  );
  app = await electron.launch({
    executablePath: electronBinary,
    args: [APP_ROOT],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      HOME: tempHome,
      ELECTRON_ENABLE_LOGGING: "1",
    },
    timeout: 60_000,
  });

  app.process().stdout?.on("data", (d: Buffer) => {
    const line = d.toString().trim();
    if (line) console.log("[main]", line);
  });
  app.process().stderr?.on("data", (d: Buffer) => {
    const line = d.toString().trim();
    if (line) console.log("[main-err]", line);
  });

  window = await app.firstWindow({ timeout: 30_000 });
  await window.waitForLoadState("domcontentloaded");

  window.on("pageerror", (err) => {
    rendererErrors.push(`pageerror: ${err.stack ?? err.message}`);
  });
  window.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      // React DevTools nag, autofill warnings, etc. — filter the known
      // benign ones if they show up in CI. Keep the list tight; real
      // errors should fail the test.
      if (/Download the React DevTools/i.test(text)) return;
      rendererErrors.push(`console.error: ${text}`);
    }
  });

  // Wizard should be the first thing visible on a fresh HOME.
  await expect(window.getByText("Gistlist setup")).toBeVisible({
    timeout: 30_000,
  });
});

test.afterAll(async () => {
  if (app) await app.close();
  if (tempHome && fs.existsSync(tempHome)) {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

async function expectNoRendererErrors() {
  await expect(
    window.getByText("The app hit a screen-level error"),
  ).toHaveCount(0);
  expect(
    rendererErrors,
    `unexpected renderer errors:\n${rendererErrors.join("\n")}`,
  ).toEqual([]);
}

async function backToStart() {
  // Click Back as many times as needed to return to the welcome step
  // without finishing setup. Bounded to avoid infinite loops.
  for (let i = 0; i < 6; i++) {
    const back = window.getByRole("button", { name: "Back" });
    if ((await back.count()) === 0) break;
    await back.click();
  }
}

test("1. wizard renders all five steps without crashing (Ollama path)", async () => {
  await expectNoRendererErrors();

  // Step 0: Welcome
  await expect(
    window.getByRole("heading", { name: "Welcome to Gistlist" }),
  ).toBeVisible();
  await window.getByRole("button", { name: "Get started" }).click();

  // Step 1: Obsidian (skip)
  await expect(
    window.getByRole("heading", { name: "Do you use Obsidian?" }),
  ).toBeVisible();
  await window.getByRole("button", { name: "Next" }).click();

  // Step 2: Data dir (accept default)
  await expect(
    window.getByRole("heading", {
      name: "Where should meetings be stored?",
    }),
  ).toBeVisible();
  await window.getByRole("button", { name: "Next" }).click();

  // Step 3: Transcription & Summarization
  await expect(
    window.getByRole("heading", { name: "Transcription & Summarization" }),
  ).toBeVisible();

  // Switch summarization to Local (Ollama) — this is the case that used
  // to crash and the case that exercises the local-model picker.
  const llmProvider = window.getByRole("combobox").nth(1);
  await llmProvider.click();
  await window.getByRole("option", { name: /Local \(Ollama\)/ }).click();

  // Local-model picker should render exactly one combobox (regression
  // guard against the old two-dropdown layout).
  const picker = window.getByTestId("local-llm-picker");
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("combobox")).toHaveCount(1);

  // The unified picker must not list the embedding-only model as a chat
  // model. Open the dropdown and check.
  await window.getByTestId("local-llm-select").click();
  await expect(
    window.getByRole("option", { name: /nomic-embed-text/ }),
  ).toHaveCount(0);
  // Close by picking whichever option is currently visible.
  await window.keyboard.press("Escape");

  await window.getByRole("button", { name: "Next" }).click();

  // Step 4: Dependencies — must render (this is where the crash lived).
  await expect(
    window.getByRole("heading", { name: "Dependencies" }),
  ).toBeVisible({ timeout: 15_000 });

  await expectNoRendererErrors();

  // Walk back so the next test starts from a known state.
  await backToStart();
});

test("2. Claude path hides the local-model picker and accepts a fake key", async () => {
  // Reload so wizard state from test 1 (LLM provider = Ollama) doesn't
  // persist into test 2's expectations.
  await window.reload();
  await expect(window.getByText("Gistlist setup")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    window.getByRole("heading", { name: "Welcome to Gistlist" }),
  ).toBeVisible();
  await window.getByRole("button", { name: "Get started" }).click();
  await window.getByRole("button", { name: "Next" }).click(); // skip Obsidian
  await window.getByRole("button", { name: "Next" }).click(); // accept data dir

  await expect(
    window.getByRole("heading", { name: "Transcription & Summarization" }),
  ).toBeVisible();

  // Default LLM provider is Claude. Local-model picker must not render.
  await expect(window.getByTestId("local-llm-picker")).toHaveCount(0);

  // Anthropic key field is required to advance.
  const next = window.getByRole("button", { name: "Next" });
  await expect(next).toBeDisabled();
  await window
    .locator('input[type="password"]')
    .first()
    .fill("sk-ant-fake-test-key");
  await expect(next).toBeEnabled();

  await expectNoRendererErrors();
});
