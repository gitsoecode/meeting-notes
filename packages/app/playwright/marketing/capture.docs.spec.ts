import { test, expect } from "@playwright/test";
import { installMockApi } from "../mock-api";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

// Docs-site screenshot capture. Produces the screenshots embedded in
// `gistlist/web/src/content/docs/...` pages. Outputs to
// `gistlist/web/public/docs/screenshots/<page-slug>/<name>.png`.
//
// Not part of the e2e suite — invoked via `npm run capture:docs`. The
// fixture content matches `capture.spec.ts` (synthetic "Acme onboarding
// retro") so the docs and the marketing page stay visually consistent.

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUT_ROOT = resolve(
  __dirname,
  "../../../../..",
  "gistlist/web/public/docs/screenshots",
);

function outFor(slug: string, name: string): string {
  const dir = resolve(OUT_ROOT, slug);
  mkdirSync(dir, { recursive: true });
  return resolve(dir, name);
}

const ACME_RUN_FOLDER = "/runs/weekly-planning";
const ACME_TITLE = "Acme onboarding retro";
const ACME_DESCRIPTION =
  "Review how the first onboarding cohort landed and what to ship before the next batch.";
const ACME_PARTICIPANTS = ["K. Liu", "S. Patel", "R. Okafor"];

const ACME_SUMMARY_MD = `# Summary

The team walked through the first onboarding cohort and agreed the welcome
flow is solid but the second-day drop-off is still the biggest concern.
Most of the discussion focused on instrumentation gaps and a lightweight
check-in sequence to bring people back before day three.

## Highlights

- Cohort 1 completed setup at 82% — up from 61% in the pilot.
- Day-2 drop-off is the weakest link; no clear trigger for re-engagement today.
- Welcome email copy is landing well; in-app tooltips feel redundant.
- Pricing FAQ surfaced twice unprompted — add a quieter inline hint instead.

## Action items

- [ ] **K. Liu** — draft the day-2 check-in sequence (copy + trigger rules) by Fri.
- [ ] **S. Patel** — add missing events for tooltip dismissals and pricing-FAQ opens.
- [ ] **R. Okafor** — pull a clean funnel chart for the next review; include mobile split.
- [ ] Owner TBD — decide whether the pricing FAQ moves inline or stays in help.
`;

const ACME_TRANSCRIPT_MD = `---
source: mock
---
### K. Liu
\`00:00\` Welcome everyone — quick retro on the first onboarding cohort.

\`00:18\` Setup completion is at 82 percent, which is the headline.

### S. Patel
\`00:34\` The bigger concern is day two. We lose about a third of people there.

### R. Okafor
\`00:55\` Agreed. The welcome email is doing its job, but nothing pulls people back on day two.

### K. Liu
\`01:20\` Let's sketch a check-in sequence. Either an email or an in-app nudge.

### S. Patel
\`01:44\` I also want to flag the pricing FAQ — it came up twice without prompting.
`;

const ACME_NOTES_MD = `# Prep notes

- Review cohort-1 funnel vs. pilot.
- Decide on day-2 re-engagement approach.
- Pricing FAQ placement — keep or move inline?
`;

async function seedAcmeMeeting(page: import("@playwright/test").Page) {
  await installMockApi(page);
  await page.addInitScript(
    ([folder, title, description, participants, summaryMd, transcriptMd, notesMd]) => {
      const poll = () => {
        const anyWindow = window as typeof window & { api?: any };
        if (!anyWindow.api?.runs) {
          setTimeout(poll, 10);
          return;
        }
        const origList = anyWindow.api.runs.list.bind(anyWindow.api.runs);
        const origGet = anyWindow.api.runs.get.bind(anyWindow.api.runs);
        const origReadDoc = anyWindow.api.runs.readDocument.bind(anyWindow.api.runs);
        const origReadPrep = anyWindow.api.runs.readPrep?.bind(anyWindow.api.runs);

        anyWindow.api.runs.list = async () => {
          const all = await origList();
          return all
            .filter((r: any) => r.status === "complete")
            .map((r: any) => {
              if (r.folder_path === folder) {
                return {
                  ...r,
                  title,
                  description,
                  tags: ["onboarding", "retro"],
                };
              }
              return r;
            });
        };

        anyWindow.api.runs.get = async (runFolder: string) => {
          const detail = await origGet(runFolder);
          if (runFolder === folder && detail) {
            return {
              ...detail,
              title,
              description,
              tags: ["onboarding", "retro"],
              manifest: {
                ...detail.manifest,
                description,
                participants,
                tags: ["onboarding", "retro"],
              },
            };
          }
          return detail;
        };

        anyWindow.api.runs.readDocument = async (runFolder: string, fileName: string) => {
          if (runFolder === folder) {
            if (fileName === "summary.md") return summaryMd;
            if (fileName === "transcript.md") return transcriptMd;
            if (fileName === "notes.md") return notesMd;
          }
          return origReadDoc(runFolder, fileName);
        };

        if (origReadPrep) {
          anyWindow.api.runs.readPrep = async (runFolder: string) => {
            if (runFolder === folder) return "";
            return origReadPrep(runFolder);
          };
        }
      };
      poll();
    },
    [
      ACME_RUN_FOLDER,
      ACME_TITLE,
      ACME_DESCRIPTION,
      ACME_PARTICIPANTS,
      ACME_SUMMARY_MD,
      ACME_TRANSCRIPT_MD,
      ACME_NOTES_MD,
    ],
  );
}

async function settle(page: import("@playwright/test").Page, ms = 600) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(ms);
}

test.describe.configure({ mode: "serial" });

test("meetings/details-summary.png", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 800 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await seedAcmeMeeting(page);

  await page.goto(
    `/#/meeting/${encodeURIComponent(ACME_RUN_FOLDER)}/details?tab=summary`,
  );
  await expect(page.getByText("Cohort 1 completed setup")).toBeVisible({
    timeout: 15_000,
  });
  await settle(page, 800);

  const outPath = outFor("meetings", "details-summary.png");
  await page.screenshot({ path: outPath, type: "png", fullPage: false });
  console.log(`wrote ${outPath}`);
  await context.close();
});

test("meetings/details-transcript.png", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 800 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await seedAcmeMeeting(page);

  await page.goto(
    `/#/meeting/${encodeURIComponent(ACME_RUN_FOLDER)}/details?tab=transcript`,
  );
  await expect(page.getByText("Welcome everyone")).toBeVisible({
    timeout: 15_000,
  });
  await settle(page, 800);

  const outPath = outFor("meetings", "details-transcript.png");
  await page.screenshot({ path: outPath, type: "png", fullPage: false });
  console.log(`wrote ${outPath}`);
  await context.close();
});

test("settings/integrations.png", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1000, height: 700 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await installMockApi(page);
  await page.addInitScript(() => {
    const poll = () => {
      const anyWindow = window as typeof window & { api?: any };
      if (!anyWindow.api?.integrations?.getMcpStatus) {
        setTimeout(poll, 10);
        return;
      }
      anyWindow.api.integrations.getMcpStatus = async () => ({
        serverJsPath:
          "/Applications/Gistlist.app/Contents/Resources/mcp-server/server.js",
        serverJsExists: true,
        configInstalled: false,
        configReadError: null,
        claudeConfigPath:
          "~/Library/Application Support/Claude/claude_desktop_config.json",
        claudeDesktopInstalled: "yes",
        meetingsIndexed: 47,
        ollamaRunning: true,
      });
    };
    poll();
  });

  await page.goto("/#/settings");
  await page.getByRole("tab", { name: "Integrations" }).click();
  await expect(
    page.getByRole("button", { name: /Install Gistlist for Claude Desktop/i }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("47 meetings indexed")).toBeVisible({
    timeout: 10_000,
  });
  await settle(page, 500);

  const outPath = outFor("settings", "integrations.png");
  await page.screenshot({ path: outPath, type: "png", fullPage: false });
  console.log(`wrote ${outPath}`);
  await context.close();
});

test("settings/storage.png", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1000, height: 700 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await installMockApi(page);

  await page.goto("/#/settings");
  await page.getByRole("tab", { name: "Storage" }).click();
  await expect(page.getByText(/Audio storage/i)).toBeVisible({
    timeout: 10_000,
  });
  await settle(page, 500);

  const outPath = outFor("settings", "storage.png");
  await page.screenshot({ path: outPath, type: "png", fullPage: false });
  console.log(`wrote ${outPath}`);
  await context.close();
});
