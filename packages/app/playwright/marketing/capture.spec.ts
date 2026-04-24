import { test, expect, chromium } from "@playwright/test";
import { installMockApi } from "../mock-api";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

// Marketing screenshot capture. Produces `hero-app.png` and `prompt-file.png`
// in `gistlist/web/public/assets/`. Not part of the e2e suite — invoked via
// `npm run capture:marketing`. See docs in CLAUDE plan file.

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUT_DIR = resolve(__dirname, "../../../../..", "gistlist/web/public/assets");
mkdirSync(OUT_DIR, { recursive: true });

// Synthetic content — no real names, companies, or projects.
const ACME_RUN_FOLDER = "/runs/weekly-planning"; // reuse existing "complete" mock run
const ACME_TITLE = "Acme onboarding retro";
const ACME_DESCRIPTION = "Review how the first onboarding cohort landed and what to ship before the next batch.";
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

## Open questions

- Is the day-2 check-in an email, an in-app nudge, or both?
- Do we gate the pricing hint to paid-plan prospects only?
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

const SUMMARY_PROMPT_BODY = `You are a meeting analyst. Given the transcript and any manual notes from this
meeting, produce two sections.

## Summary
A concise summary covering:
- Key topics discussed
- Decisions made
- Important context or background

## Action Items
Extract all action items as a checklist. For each item include:
- What needs to be done
- Who is responsible (if mentioned)
- Deadline (if mentioned)

Format the entire response as clean markdown.
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

async function seedSummaryPromptBody(page: import("@playwright/test").Page) {
  await page.addInitScript((body: string) => {
    const poll = () => {
      const anyWindow = window as typeof window & { api?: any };
      if (!anyWindow.api?.prompts?.list) {
        setTimeout(poll, 10);
        return;
      }
      const origList = anyWindow.api.prompts.list.bind(anyWindow.api.prompts);
      anyWindow.api.prompts.list = async () => {
        const all = await origList();
        return all.map((p: any) => (p.id === "summary" ? { ...p, body } : p));
      };
    };
    poll();
  }, SUMMARY_PROMPT_BODY);
}

// Give the route/detail load a beat to settle after navigation.
async function settle(page: import("@playwright/test").Page, ms = 600) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(ms);
}

test.describe.configure({ mode: "serial" });

test("hero-app.png", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 960, height: 600 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await seedAcmeMeeting(page);
  await seedSummaryPromptBody(page);

  await page.goto(
    `/#/meeting/${encodeURIComponent(ACME_RUN_FOLDER)}/details?tab=summary`,
  );
  await expect(page.getByText("Cohort 1 completed setup")).toBeVisible({ timeout: 15_000 });
  await settle(page, 1000);

  const outPath = resolve(OUT_DIR, "hero-app.png");
  await page.screenshot({ path: outPath, type: "png", fullPage: false });
  console.log(`wrote ${outPath}`);
  await context.close();
});

test("prompt-file.png", async ({ browser }) => {
  const panelWidth = 800;
  const panelHeight = 1200;

  // Left pane: summary.md rendered as a raw source file (YAML frontmatter + prompt body),
  // styled to match the Gistlist app's light theme. A single tab row shows the filename.
  const summaryMdSource = `---\nid: summary\nlabel: Summary & Action Items\nfilename: summary.md\nenabled: true\nauto: true\n---\n\nYou are a meeting analyst. Given the transcript and any manual notes\nfrom this meeting, produce two sections.\n\n## Summary\nA concise summary covering:\n- Key topics discussed\n- Decisions made\n- Important context or background\n\n## Action Items\nExtract all action items as a checklist. For each item include:\n- What needs to be done\n- Who is responsible (if mentioned)\n- Deadline (if mentioned)\n\nFormat the entire response as clean markdown.\n`;
  const leftHtml = `<!doctype html>
<html><head><meta charset="utf-8"/>
<style>
  :root {
    --bg: #F4F5F5;
    --surface: #FFFFFF;
    --border: #E8E9E8;
    --text: #1E3322;
    --text-secondary: #5C6B60;
    --accent: #2D6B3F;
    --frontmatter: #8A6A1F;
    --heading: #2D6B3F;
  }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font-family: -apple-system, 'SF Pro Text', 'Segoe UI', sans-serif; }
  body { width: ${panelWidth}px; height: ${panelHeight}px; display: flex; flex-direction: column; }
  .tabs { display: flex; align-items: stretch; background: var(--bg); border-bottom: 1px solid var(--border); height: 36px; padding: 0 16px; }
  .tab { display: inline-flex; align-items: center; gap: 8px; padding: 0 14px; height: 100%; font-size: 13px; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-bottom: 1px solid var(--surface); border-top-left-radius: 6px; border-top-right-radius: 6px; margin-bottom: -1px; }
  .tab .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); opacity: 0.7; }
  .editor { flex: 1; padding: 28px 32px; background: var(--surface); overflow: hidden; }
  pre { margin: 0; font-family: 'IBM Plex Mono', 'SF Mono', Menlo, Monaco, monospace; font-size: 13.5px; line-height: 1.7; color: var(--text); white-space: pre-wrap; word-break: break-word; }
  .fm { color: var(--frontmatter); }
  .fm-delim { color: var(--text-secondary); }
  .h { color: var(--heading); font-weight: 600; }
  .li { color: var(--text); }
  .tx { color: var(--text); }
</style>
</head><body>
<div class="tabs"><div class="tab"><span class="dot"></span>summary.md</div></div>
<div class="editor"><pre id="src"></pre></div>
<script>
  const src = ${JSON.stringify(summaryMdSource)};
  const lines = src.split("\\n");
  const out = [];
  let inFm = false;
  for (const line of lines) {
    if (line === "---") {
      out.push('<span class="fm-delim">' + line + '</span>');
      inFm = !inFm;
      continue;
    }
    if (inFm) {
      out.push('<span class="fm">' + line + '</span>');
      continue;
    }
    if (/^##\\s/.test(line)) {
      out.push('<span class="h">' + line + '</span>');
      continue;
    }
    if (/^-\\s/.test(line)) {
      out.push('<span class="li">' + line + '</span>');
      continue;
    }
    out.push('<span class="tx">' + line + '</span>');
  }
  document.getElementById("src").innerHTML = out.join("\\n");
</script>
</body></html>`;

  const leftCtx = await browser.newContext({
    viewport: { width: panelWidth, height: panelHeight },
    deviceScaleFactor: 1,
  });
  const leftPage = await leftCtx.newPage();
  await leftPage.setContent(leftHtml, { waitUntil: "load" });
  await leftPage.waitForTimeout(200);
  const leftBuf = await leftPage.screenshot({ type: "png", fullPage: false });
  await leftCtx.close();

  // Right pane: the app's rendered summary detail view, just the main content
  // (no sidebar/header chrome — keeps the composite focused on the output).
  const rightCtx = await browser.newContext({
    viewport: { width: 1200, height: panelHeight },
    deviceScaleFactor: 1,
  });
  const rightPage = await rightCtx.newPage();
  await seedAcmeMeeting(rightPage);
  await seedSummaryPromptBody(rightPage);
  await rightPage.goto(
    `/#/meeting/${encodeURIComponent(ACME_RUN_FOLDER)}/details?tab=summary`,
  );
  await expect(rightPage.getByText("Cohort 1 completed setup")).toBeVisible({ timeout: 15_000 });
  await settle(rightPage, 1000);
  // Crop to just the <main> element's bounding box to strip sidebar + top chrome.
  const mainEl = rightPage.locator("main").first();
  const box = await mainEl.boundingBox();
  if (!box) throw new Error("main element not found");
  const rightBuf = await rightPage.screenshot({
    type: "png",
    clip: {
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.min(panelWidth, Math.round(box.width)),
      height: Math.min(panelHeight, Math.round(box.height)),
    },
  });
  await rightCtx.close();

  // Compose side-by-side with a 1px divider using an HTML canvas page.
  const compCtx = await browser.newContext({
    viewport: { width: 1600, height: 1200 },
    deviceScaleFactor: 1,
  });
  const compPage = await compCtx.newPage();
  const leftB64 = leftBuf.toString("base64");
  const rightB64 = rightBuf.toString("base64");
  const composeHtml = `<!doctype html>
<html><head><meta charset="utf-8"/>
<style>
  html,body{margin:0;padding:0;background:#fff}
  .wrap{display:flex;width:1600px;height:1200px}
  .pane{width:800px;height:1200px;display:block}
  .pane img{width:800px;height:1200px;display:block;object-fit:cover;object-position:top left}
  .divider{width:1px;height:1200px;background:#E8E9E8}
  .wrap > .pane:first-child{width:799px}
  .wrap > .pane:first-child img{width:799px}
</style>
</head><body>
<div class="wrap">
  <div class="pane"><img src="data:image/png;base64,${leftB64}"/></div>
  <div class="divider"></div>
  <div class="pane"><img src="data:image/png;base64,${rightB64}"/></div>
</div>
</body></html>`;
  await compPage.setContent(composeHtml, { waitUntil: "load" });
  await compPage.waitForTimeout(200);
  const outPath = resolve(OUT_DIR, "prompt-file.png");
  await compPage.screenshot({ path: outPath, type: "png", fullPage: false });
  console.log(`wrote ${outPath}`);
  await compCtx.close();
});
