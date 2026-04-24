/**
 * Handles `gistlist://` deep links. Claude Desktop (and any host that
 * renders markdown) turns citation links into clickable URLs; clicking
 * fires the OS URL handler, and macOS routes the URL here.
 *
 * URL shapes:
 *   gistlist://meeting/<run_id>
 *   gistlist://meeting/<run_id>?t=<start_ms>
 *   gistlist://meeting/<run_id>?source=<summary|prep|notes|transcript>
 *
 * Two edge cases to handle carefully:
 *
 *  1. **Cold launch via deep link.** macOS launches the app and fires
 *     `open-url` very early — possibly before `app.whenReady()` resolves
 *     and certainly before `mainWindow` exists. We defer all window
 *     interaction through `app.whenReady().then(...)`.
 *  2. **Renderer subscription race.** Electron's `webContents.send`
 *     doesn't queue, so broadcasting before the renderer's `appAction`
 *     subscription is live silently drops the event. The renderer calls
 *     `deep-link:ready` once subscribed; we queue events until then and
 *     flush the queue on signal.
 */
import { app, ipcMain } from "electron";
import { broadcastAppAction } from "./ipc.js";
import { ensureMainWindow } from "./index.js";
import type { AppActionEvent } from "../shared/ipc.js";

const SCHEME = "gistlist";
const READY_CHANNEL = "deep-link:ready";

type OpenMeetingEvent = Extract<AppActionEvent, { type: "open-meeting" }>;

let rendererReady = false;
const pending: OpenMeetingEvent[] = [];

export function registerGistlistProtocol(): void {
  app.setAsDefaultProtocolClient(SCHEME);

  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  // Windows/Linux route custom URLs through argv on second-instance; we're
  // macOS-only today but guard both so this doesn't silently break if the
  // app ever ships cross-platform.
  app.on("second-instance", (_event, argv) => {
    const urlArg = argv.find((a) => a.startsWith(`${SCHEME}://`));
    if (urlArg) handleDeepLink(urlArg);
  });

  // Renderer signals it has subscribed to `appAction`. We flush any URLs
  // that arrived during cold-launch / window-reload and mark ready so
  // future links broadcast immediately.
  //
  // Reset `rendererReady` when the renderer is reloaded (e.g. dev HMR or
  // window close/recreate) so we don't broadcast into a dead subscription.
  ipcMain.on(READY_CHANNEL, (event) => {
    rendererReady = true;
    const toFlush = pending.splice(0);
    for (const e of toFlush) broadcastAppAction(e);
    event.sender.once("destroyed", () => {
      rendererReady = false;
    });
    event.sender.once("did-start-loading", () => {
      rendererReady = false;
    });
  });
}

function handleDeepLink(rawUrl: string): void {
  const parsed = parseGistlistUrl(rawUrl);
  if (!parsed) return;

  // `app.whenReady()` resolves synchronously (microtask) once the app is
  // ready, so there's no penalty in the already-running case. For a cold
  // launch, this defers window creation until Electron is actually ready
  // to build BrowserWindows.
  void app.whenReady().then(() => {
    const win = ensureMainWindow();
    win.focus();
    if (rendererReady) {
      broadcastAppAction(parsed);
    } else {
      pending.push(parsed);
    }
  });
}

function parseGistlistUrl(raw: string): OpenMeetingEvent | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== `${SCHEME}:`) return null;

  // Electron normalizes `gistlist://meeting/<id>` so host="meeting" and
  // pathname="/<id>" on macOS. Accept either shape defensively.
  const host = url.hostname || "";
  const pathSegments = url.pathname.split("/").filter(Boolean);
  let kind: string | undefined;
  let runId: string | undefined;
  if (host && pathSegments[0]) {
    kind = host;
    runId = pathSegments[0];
  } else if (pathSegments.length >= 2) {
    kind = pathSegments[0];
    runId = pathSegments[1];
  }
  if (kind !== "meeting" || !runId) return null;

  const tRaw = url.searchParams.get("t");
  const startMs = tRaw != null && /^\d+$/.test(tRaw) ? Number.parseInt(tRaw, 10) : null;

  const sourceRaw = url.searchParams.get("source");
  const citationSource = isCitationSource(sourceRaw) ? sourceRaw : null;

  return {
    type: "open-meeting",
    source: "deep-link",
    runId,
    startMs,
    citationSource,
  };
}

function isCitationSource(
  v: string | null
): v is "transcript" | "summary" | "prep" | "notes" {
  return v === "transcript" || v === "summary" || v === "prep" || v === "notes";
}
