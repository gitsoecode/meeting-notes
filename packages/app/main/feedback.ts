/**
 * Feedback / support helpers.
 *
 * Two surfaces:
 *   - "Send Feedback…" → opens a `mailto:` URL with subject + body
 *     pre-populated (app version, OS version, Electron version). The
 *     user attaches logs manually using "Reveal logs in Finder" —
 *     `mailto` does not support attachments.
 *   - "Reveal Logs" → opens a Finder window pointed at the engine's
 *     `~/.gistlist/` directory (where `app.log` and `ollama.log` live).
 *
 * Local-first contract: nothing is uploaded, no analytics, no Sentry.
 * Logs stay on disk. The user controls what they email.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, shell } from "electron";
import { logsDir } from "./paths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPPORT_EMAIL = "support@gistlist.co";

function buildMailtoUrl(): string {
  const version = app.getVersion();
  const subject = `Gistlist feedback (v${version})`;
  const body = [
    "",
    "",
    "---",
    "Please describe what happened above this line. The bits below help us",
    "reproduce — feel free to edit anything you don't want to share.",
    "",
    `App version: ${version}`,
    `Electron:    ${process.versions.electron ?? "unknown"}`,
    `Node:        ${process.versions.node ?? "unknown"}`,
    `Platform:    ${process.platform} (${process.arch})`,
    `OS:          ${process.getSystemVersion?.() ?? "unknown"}`,
    "",
    "Tip: click Reveal Logs in Finder to attach app.log to this email.",
  ].join("\n");
  // mailto encoding: spaces → %20, newlines → %0A. Use encodeURIComponent
  // and then translate '+' back to '%20' (encodeURIComponent leaves '+'
  // alone but `mailto` clients vary in handling it — explicit %20 is safer).
  const enc = (s: string) => encodeURIComponent(s).replace(/%20/g, "%20");
  return `mailto:${SUPPORT_EMAIL}?subject=${enc(subject)}&body=${enc(body)}`;
}

/** Open the user's default mail client with the support template ready. */
export async function openFeedbackMail(): Promise<void> {
  await shell.openExternal(buildMailtoUrl());
}

/** Reveal the logs folder in Finder. */
export async function revealLogsInFinder(): Promise<void> {
  await shell.openPath(logsDir());
}

/**
 * Open the bundled THIRD_PARTY_LICENSES.md file in the user's default
 * Markdown / text viewer.
 *
 * Path resolution: in a packaged build the file lives OUTSIDE app.asar
 * under `Contents/Resources/THIRD_PARTY_LICENSES.md` (placed there by
 * the `extraResources` entry in package.json's electron-builder config).
 * It has to live outside asar because `shell.openPath` hands the path
 * to a system viewer, and external apps can't read inside an asar
 * archive — they see the path as a single .asar file rather than the
 * tree inside it.
 *
 * In dev (`!app.isPackaged`) the file is just at
 * `packages/app/assets/THIRD_PARTY_LICENSES.md` — there's no asar.
 */
export async function openLicensesFile(): Promise<void> {
  const assetPath = app.isPackaged
    ? path.join(process.resourcesPath, "THIRD_PARTY_LICENSES.md")
    : path.resolve(__dirname, "../../assets/THIRD_PARTY_LICENSES.md");
  await shell.openPath(assetPath);
}
