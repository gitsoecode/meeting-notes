import { test, expect, chromium } from "@playwright/test";
import { installMockApi } from "../mock-api";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

// Marketing screenshot capture. Produces `hero-app.png`, `prompt-file.png`,
// `claude-answer-citations.png`, and `integrations-install.png` in
// `gistlist/web/public/assets/`. Not part of the e2e suite — invoked via
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

// ─────────────────────────────────────────────────────────────────────────
// Claude Desktop conversation shot. Sourced from a real screenshot (the
// portrait PNG in ./assets/), trimmed of top/bottom whitespace, then scaled
// to fit on a 1920×1200 white canvas to match the 16:10 spec the landing
// page expects. We don't drive the real Claude Desktop app from Playwright,
// so regeneration means dropping a new source PNG into ./assets/ and
// rerunning this test.
// ─────────────────────────────────────────────────────────────────────────
test("claude-answer-citations.png", async ({ browser }) => {
  const sourcePath = resolve(
    __dirname,
    "assets/claude-answer-citations-source.png",
  );
  const sourceB64 = readFileSync(sourcePath).toString("base64");

  const TARGET_W = 1920;
  const TARGET_H = 1200;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"/>
<style>
  html, body { margin: 0; padding: 0; background: #FFFFFF; }
  body { width: ${TARGET_W}px; height: ${TARGET_H}px; display: flex; align-items: center; justify-content: center; }
  canvas { display: block; }
</style></head>
<body>
  <canvas id="c" width="${TARGET_W}" height="${TARGET_H}"></canvas>
  <script>
    (async () => {
      const img = new Image();
      img.src = "data:image/png;base64,${sourceB64}";
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });

      // Trim near-white top/bottom rows so content isn't floating in padding.
      const off = document.createElement("canvas");
      off.width = img.width; off.height = img.height;
      const octx = off.getContext("2d", { willReadFrequently: true });
      octx.drawImage(img, 0, 0);
      const data = octx.getImageData(0, 0, img.width, img.height).data;
      const w = img.width, h = img.height;
      const rowBlank = (y, thresh = 248) => {
        const step = Math.max(1, Math.floor(w / 40));
        for (let x = 0; x < w; x += step) {
          const i = (y * w + x) * 4;
          if (data[i] < thresh || data[i+1] < thresh || data[i+2] < thresh) return false;
        }
        return true;
      };
      let top = 0; while (top < h && rowBlank(top)) top++;
      let bot = h - 1; while (bot > top && rowBlank(bot)) bot--;
      const margin = 24;
      top = Math.max(0, top - margin);
      bot = Math.min(h - 1, bot + margin);
      const cropH = bot - top + 1;

      // Scale-to-fit within target, preserving aspect. Center on white.
      const scale = Math.min(TARGET_W / w, TARGET_H / cropH);
      const drawW = Math.round(w * scale);
      const drawH = Math.round(cropH * scale);
      const ox = Math.round((TARGET_W - drawW) / 2);
      const oy = Math.round((TARGET_H - drawH) / 2);

      const c = document.getElementById("c");
      const ctx = c.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, TARGET_W, TARGET_H);
      ctx.drawImage(img, 0, top, w, cropH, ox, oy, drawW, drawH);

      const blob = await new Promise(r => c.toBlob(r, "image/png"));
      const buf = await blob.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
      document.body.setAttribute("data-png", hex);
    })();
  </script>
</body></html>`;

  const ctx = await browser.newContext({
    viewport: { width: TARGET_W, height: TARGET_H },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  // Define TARGET_W / TARGET_H inside the page too (setContent doesn't see outer scope).
  const pageHtml = html.replace(
    "<script>",
    `<script>const TARGET_W=${TARGET_W};const TARGET_H=${TARGET_H};`,
  );
  await page.setContent(pageHtml, { waitUntil: "load" });
  await page.waitForFunction(() => document.body.getAttribute("data-png") != null, null, {
    timeout: 15_000,
  });
  const hex = await page.getAttribute("body", "data-png");
  if (!hex) throw new Error("canvas produced no PNG data");
  const outPath = resolve(OUT_DIR, "claude-answer-citations.png");
  writeFileSync(outPath, Buffer.from(hex, "hex"));
  console.log(`wrote ${outPath}`);
  await ctx.close();
});

// ─────────────────────────────────────────────────────────────────────────
// Gistlist Settings → Integrations tab, pre-install state. Drives the real
// renderer and swaps in a marketing-friendly MCP status (N=47 meetings,
// Claude Desktop detected, Ollama running, not-yet-installed).
// ─────────────────────────────────────────────────────────────────────────
test("integrations-install.png", async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
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
  // Click into the Integrations tab.
  await page.getByRole("tab", { name: "Integrations" }).click();
  await expect(
    page.getByRole("button", { name: /Install Gistlist for Claude Desktop/i }),
  ).toBeVisible({ timeout: 10_000 });
  // Wait for the status list (meetings indexed) to reflect our override.
  await expect(page.getByText("47 meetings indexed")).toBeVisible({ timeout: 10_000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(500);

  const outPath = resolve(OUT_DIR, "integrations-install.png");
  await page.screenshot({ path: outPath, type: "png", fullPage: false });
  console.log(`wrote ${outPath}`);
  await ctx.close();
});
