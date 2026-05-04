#!/usr/bin/env node
/**
 * Render `build/dmg-background.svg` into the @1x and @2x PNGs that
 * electron-builder bakes into the DMG window background.
 *
 * Why this script exists: the DMG background is a static raster (DMGs
 * don't honor SVG and aren't theme-aware). We commit the SVG as the
 * source of truth and the PNGs as the byte-stable build inputs. This
 * script regenerates the PNGs deterministically so future tweaks are a
 * one-command refresh, not a binary-only edit.
 *
 * Usage: `node packages/app/scripts/build-dmg-background.mjs`
 *
 * Wired into `npm run build:assets` so a fresh checkout regenerates
 * before electron-builder picks up the asset. Safe to run idempotently
 * — sharp produces deterministic PNG bytes for the same SVG input.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.resolve(__dirname, "..", "build");

const SOURCE = path.join(buildDir, "dmg-background.svg");
const OUT_1X = path.join(buildDir, "dmg-background.png");
const OUT_2X = path.join(buildDir, "dmg-background@2x.png");

const WIDTH = 540;
const HEIGHT = 380;

async function render(densityScale, outPath) {
  const svg = await fs.readFile(SOURCE);
  // sharp's SVG renderer takes a `density` arg (DPI) — at 72 DPI the
  // SVG renders 1:1 to its declared viewBox (540×380). For @2x we
  // double the density to get 1080×760 with crisp vector edges.
  const buf = await sharp(svg, { density: 72 * densityScale })
    .resize({
      width: WIDTH * densityScale,
      height: HEIGHT * densityScale,
      fit: "fill",
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await fs.writeFile(outPath, buf);
  return buf.length;
}

async function main() {
  try {
    await fs.access(SOURCE);
  } catch {
    console.error(`[build-dmg-background] missing source SVG: ${SOURCE}`);
    process.exit(1);
  }
  const size1x = await render(1, OUT_1X);
  const size2x = await render(2, OUT_2X);
  console.log(
    `[build-dmg-background] wrote ${path.relative(process.cwd(), OUT_1X)} (${size1x} B) + @2x (${size2x} B)`,
  );
}

main().catch((err) => {
  console.error("[build-dmg-background] failed:", err);
  process.exit(1);
});
