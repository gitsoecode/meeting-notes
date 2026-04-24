#!/usr/bin/env node
import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OUT_DIR = resolve(
  __dirname,
  "../../../..",
  "gistlist/web/public/assets",
);
const FONT_PATH = resolve(
  __dirname,
  "../../../..",
  "gistlist/web/public/fonts/PlayfairDisplay-SemiBold.woff2",
);
const OUT_FILE = resolve(OUT_DIR, "og-image.png");

mkdirSync(OUT_DIR, { recursive: true });

const fontUrl = pathToFileURL(FONT_PATH).href;

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @font-face {
    font-family: "Playfair Display";
    font-style: normal;
    font-weight: 600;
    font-display: block;
    src: url("${fontUrl}") format("woff2");
  }
  html, body { margin: 0; padding: 0; }
  body {
    width: 1200px;
    height: 630px;
    background: #F4F5F5;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .wordmark {
    font-family: "Playfair Display", serif;
    font-weight: 600;
    font-size: 120px;
    color: #1E3322;
    line-height: 1;
    letter-spacing: -0.005em;
  }
</style>
</head>
<body>
  <div class="wordmark">Gistlist</div>
</body>
</html>`;

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: OUT_FILE, type: "png", omitBackground: false });
  console.log(`wrote ${OUT_FILE}`);
} finally {
  await browser.close();
}
