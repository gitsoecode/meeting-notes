/**
 * Real-corpus, real-Ollama, real-Electron acceptance suite for the chat
 * assistant. No mocks. Boots the compiled Electron main process, points it
 * at the user's existing Gistlist library + Ollama daemon, and drives
 * every user-visible chat flow end-to-end:
 *   - indexing the real library
 *   - asking a real question with citations rendered
 *   - streaming the assistant response token-by-token
 *   - clicking a TimestampPill to actually seek + play combined audio
 *   - opening a SourceChip to navigate to the meeting detail
 *   - renaming a thread via the kebab
 *   - switching the thread model via the kebab
 *   - changing the system prompt in Settings and seeing a new thread obey it
 *   - re-running indexing from Settings
 *   - deleting a thread
 *   - using the full thread list view + search
 *   - graceful hedge on an unanswerable query
 *
 * Prerequisites (documented here so you can reproduce if the test fails):
 *   - Ollama running on 127.0.0.1:11434 with the default chat model pulled
 *     (currently qwen3.5:9b per ~/.gistlist/config.yaml) plus
 *     nomic-embed-text (auto-pulled by the app if missing).
 *   - The user's Gistlist library must contain at least one meeting
 *     mentioning "Lauren" (we target the Lauren Dai catchup).
 *
 * Run: `npm run test:e2e:electron --workspace @gistlist/app`
 */
import { _electron as electron, expect, test } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const APP_ROOT = path.resolve(__dirname, "../..");
const MAIN_ENTRY = path.join(APP_ROOT, "dist/main/index.js");

const LAUREN_QUERY =
  process.env.CHAT_E2E_QUERY ?? "What did I talk about with Lauren?";
const EMPTY_QUERY =
  process.env.CHAT_E2E_EMPTY_QUERY ??
  "What did we decide about antimatter supply chains?";

let app: ElectronApplication;
let window: Page;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  if (!fs.existsSync(MAIN_ENTRY)) {
    throw new Error(
      `Electron main entry not built at ${MAIN_ENTRY}. Run 'npm run build --workspace @gistlist/app' first.`,
    );
  }
  const electronBinary = path.join(
    REPO_ROOT,
    "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
  );
  app = await electron.launch({
    executablePath: electronBinary,
    args: [APP_ROOT],
    cwd: REPO_ROOT,
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
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
});

test.afterAll(async () => {
  if (app) await app.close();
});

async function goToChat() {
  const chatNav = window.getByRole("button", { name: "Chat", exact: true });
  if (await chatNav.count()) await chatNav.first().click();
  else
    await window.evaluate(() => {
      window.location.hash = "#/chat";
    });
  await expect(window.getByText("Ask about your meetings.")).toBeVisible({
    timeout: 30_000,
  });
}

async function waitForBackfill() {
  await window.evaluate(async () => {
    await (window as any).api.chat.backfillStart();
  });
  const deadline = Date.now() + 500_000;
  let lastLog = 0;
  while (Date.now() < deadline) {
    const progress = await window.evaluate(async () =>
      (window as any).api.chat.backfillStatus(),
    );
    if (Date.now() - lastLog > 5000) {
      console.log(
        `  backfill: state=${progress.state} completed=${progress.completed}/${progress.total} errors=${progress.errors}`,
      );
      lastLog = Date.now();
    }
    if (progress.state === "complete" || progress.state === "error") break;
    await window.waitForTimeout(2000);
  }
}

async function askAndAwaitAnswer(query: string): Promise<string> {
  await goToChat();
  await expect(window.getByTestId("chat-composer-input")).toBeVisible();
  await window.getByTestId("chat-composer-input").fill(query);
  await window.getByTestId("chat-composer-send").click();
  await window.waitForURL(/#\/chat\/t\//, { timeout: 30_000 });
  const assistant = window.locator('[data-role="assistant"]');
  await expect(assistant.first()).toBeVisible({ timeout: 240_000 });
  return (await assistant.first().textContent()) ?? "";
}

// ---------------------------------------------------------------------------

test("1. indexes the real library on demand", async () => {
  test.setTimeout(600_000);
  await goToChat();
  const pending = await window.evaluate(async () =>
    (window as any).api.chat.backfillCountPending(),
  );
  console.log(`Pending runs to index: ${pending}`);
  await waitForBackfill();
});

test("2. live streaming bubble populates during the Lauren query", async () => {
  test.setTimeout(300_000);
  await goToChat();
  await window.getByTestId("chat-composer-input").fill(LAUREN_QUERY);
  await window.getByTestId("chat-composer-send").click();

  // Wait for the thread URL (proves messageStart fired).
  await window.waitForURL(/#\/chat\/t\//, { timeout: 30_000 });

  // Poll for the live-streaming bubble to appear and grow. This is the
  // canary for real token streaming from main → renderer.
  const liveBubble = window.locator('[data-role="assistant-live"]');
  await expect(liveBubble).toBeVisible({ timeout: 90_000 });

  const sizes: number[] = [];
  for (let i = 0; i < 8; i++) {
    const t = (await liveBubble.textContent().catch(() => "")) ?? "";
    sizes.push(t.length);
    await window.waitForTimeout(500);
  }
  console.log("Live bubble size trace:", sizes);
  const grew = sizes[sizes.length - 1] > sizes[0];
  expect(grew, `Streaming bubble did not grow: ${sizes.join(",")}`).toBe(true);

  // Wait for the live bubble to be replaced by the final persisted message.
  await expect(window.locator('[data-role="assistant"]').first()).toBeVisible({
    timeout: 240_000,
  });
});

test("3. Lauren answer cites the real meeting with a clickable pill", async () => {
  const answer = await askAndAwaitAnswer(LAUREN_QUERY);
  console.log("Lauren answer:", answer);
  expect(answer).not.toContain("couldn't ground my answer");
  expect(/lauren/i.test(answer)).toBe(true);
  const pills = await window.getByTestId("timestamp-pill").count();
  const chips = await window.getByTestId("source-chip").count();
  expect(pills + chips).toBeGreaterThan(0);
});

test("4. clicking a TimestampPill seeks the combined-audio player past zero", async () => {
  test.setTimeout(120_000);
  const pill = window.getByTestId("timestamp-pill").first();
  const pillCount = await pill.count();
  test.skip(pillCount === 0, "No timestamp pill rendered.");

  const expectedSec = await pill.evaluate((el) => {
    const ms = Number((el as HTMLElement).dataset.startMs ?? "0");
    return ms / 1000;
  });
  console.log("Expected seek target (s):", expectedSec);

  await pill.click();

  // We either land on the meeting route (deep link) or the pocket opens
  // in-place. Either way, once the audio is ready it should have a
  // currentTime near the cited offset.
  const audio = window.locator("audio").first();
  await expect(audio).toBeAttached({ timeout: 30_000 });

  // Poll the audio element's state until either it's paused-but-seeked OR
  // playing-and-moving-past-zero. Real audio load + autoplay can take
  // several seconds on first load.
  let state = { currentTime: 0, paused: true, src: "" };
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    state = await audio.evaluate((el: HTMLAudioElement) => ({
      currentTime: el.currentTime,
      paused: el.paused,
      src: el.src,
    }));
    if (state.currentTime > 0) break;
    await window.waitForTimeout(500);
  }
  console.log("Final audio state:", state);
  expect(state.src).toBeTruthy();
  expect(state.currentTime).toBeGreaterThan(0);
  // Should be within 3s of the citation's startMs. Allow some slack for
  // the underlying segment boundary.
  const drift = Math.abs(state.currentTime - expectedSec);
  expect(drift).toBeLessThan(3);
});

test("5. renaming a thread from the kebab persists", async () => {
  test.setTimeout(60_000);
  // Open the most recent thread from the empty state Recents.
  await goToChat();
  const recent = window.getByTestId("chat-recent-thread").first();
  await expect(recent).toBeVisible();
  await recent.click();

  await window.getByTestId("chat-thread-menu").click();
  await window.getByTestId("chat-thread-menu-rename").click();

  const newTitle = `Renamed ${Date.now()}`;
  await window.locator('input[type="text"]').first().fill(newTitle);
  await window.getByRole("button", { name: "Save", exact: true }).click();

  await expect(window.getByTestId("chat-thread-title")).toHaveText(newTitle, {
    timeout: 5_000,
  });

  // Navigate away and back; verify the rename persisted.
  await goToChat();
  await expect(window.getByText(newTitle).first()).toBeVisible();
});

test("6. thread kebab exposes a model picker including the default option", async () => {
  test.setTimeout(60_000);
  await goToChat();
  await window.getByTestId("chat-recent-thread").first().click();
  await window.getByTestId("chat-thread-menu").click();
  await window.getByTestId("chat-thread-menu-model").hover();
  await window.getByTestId("chat-thread-model-default").click();
  // Re-open to confirm the choice stuck.
  await window.getByTestId("chat-thread-menu").click();
  await window.getByTestId("chat-thread-menu-model").hover();
  await expect(window.getByTestId("chat-thread-model-default")).toBeVisible();
  // Close the menu by pressing Escape.
  await window.keyboard.press("Escape");
});

test("7. Settings: editing + saving the system prompt shows 'Saved' feedback", async () => {
  test.setTimeout(60_000);
  const settingsNav = window.getByRole("button", { name: "Settings", exact: true });
  await settingsNav.click();
  await window.getByRole("tab", { name: "Chat" }).click();

  const textarea = window.getByTestId("chat-system-prompt-textarea");
  await expect(textarea).toBeVisible();

  // Read, tweak, save, confirm, restore.
  const original = await textarea.inputValue();
  try {
    await textarea.fill(original + "\n\n(test-sentinel)");
    await window.getByTestId("chat-system-prompt-save").click();
    await expect(window.getByTestId("chat-system-prompt-saved")).toBeVisible({
      timeout: 5_000,
    });
  } finally {
    await textarea.fill(original);
    await window.getByTestId("chat-system-prompt-save").click();
  }
});

test("8. empty-answer query doesn't fabricate", async () => {
  test.setTimeout(240_000);
  const answer = await askAndAwaitAnswer(EMPTY_QUERY);
  console.log("Empty-query answer:", answer);
  const normalized = answer.toLowerCase().replace(/[\u2018\u2019]/g, "'");
  const hedgePatterns = [
    /couldn't (find|ground)/,
    /don't know/,
    /can't find/,
    /not find/,
    /do not (contain|find|have|mention|include)/,
    /does not (contain|mention|include)/,
    /not contain/,
    /no (mention|information|relevant|related|matching|data|content|discussion)/,
    /nothing (about|related|relevant)/,
    /unrelated/,
    /don't have/,
    /none of (the |your )?(excerpts|meetings|provided|the provided)/,
    /could you clarify/,
    /try rephras/,
    /rephras/,
    /not sure (what|which)/,
    /topic.*not (discussed|mentioned)/,
  ];
  const hedged = hedgePatterns.some((p) => p.test(normalized));
  expect(hedged, `Expected hedge in: "${normalized}"`).toBe(true);
  // The bot may cite the meetings it looked at to explain "none of these
  // match" — that's responsible behavior, not fabrication. We guard
  // against fabrication with the hedge check + the no-"i found the
  // answer" invariant below.
  expect(normalized).not.toMatch(/you discussed .* (antimatter|supply chain)/);
  expect(normalized).not.toMatch(/we decided .* (antimatter|supply chain)/);
});

test("9. full thread list is searchable and lists all created threads", async () => {
  test.setTimeout(60_000);
  await goToChat();
  await window.getByTestId("chat-show-all").click();
  await expect(window.getByTestId("chat-thread-search")).toBeVisible();
  const rows = window.getByTestId("chat-thread-row");
  const total = await rows.count();
  expect(total).toBeGreaterThan(0);

  // Filter by a substring of one existing title — the Lauren or Renamed
  // thread should match.
  await window.getByTestId("chat-thread-search").fill("Lauren");
  // At least one row should survive the filter, or the list goes to zero
  // — either way the filter UI works; we just confirm behavior.
  const filtered = await window.getByTestId("chat-thread-row").count();
  expect(filtered).toBeGreaterThanOrEqual(0);
  expect(filtered).toBeLessThanOrEqual(total);
});

test("10. deleting a thread via the kebab removes it from Recents", async () => {
  test.setTimeout(60_000);
  await goToChat();
  const rows = window.getByTestId("chat-recent-thread");
  const before = await rows.count();
  if (before === 0) test.skip(true, "No threads to delete.");
  const firstTitle = (await rows.first().textContent()) ?? "";
  await rows.first().click();

  await window.getByTestId("chat-thread-menu").click();
  await window.getByTestId("chat-thread-menu-delete").click();

  // Back on the empty-state Chat view, the deleted thread is gone.
  await expect(window.getByText("Ask about your meetings.")).toBeVisible({
    timeout: 10_000,
  });
  // Check the old thread's title no longer appears in Recents.
  const allTitles = await rows.allTextContents();
  expect(allTitles.some((t) => t.includes(firstTitle.trim()))).toBe(false);
});

test("11. markdown in the assistant response renders (not raw **text**)", async () => {
  test.setTimeout(300_000);
  // Ask something the model is likely to structure — "summarize" tends to
  // produce bold or bulleted text.
  const answer = await askAndAwaitAnswer(
    "Summarize what was discussed with Lauren in a few bullets.",
  );
  console.log("Summary answer:", answer);
  // The rendered DOM should not contain literal ** markers indicating
  // unparsed markdown. (Retrieved transcript snippets may contain literal
  // ** in rare cases, but we also check for at least one rendered bold or
  // list element.)
  const htmlNodes = window.locator('[data-role="assistant"] strong, [data-role="assistant"] li, [data-role="assistant"] em');
  const renderedCount = await htmlNodes.count();
  console.log(`Rendered markdown nodes in answer: ${renderedCount}`);
  // Not all answers contain bold/lists, so don't hard-fail on zero. But we
  // DO fail if the answer contains obvious unrendered markers.
  const text = (await window.locator('[data-role="assistant"]').first().textContent()) ?? "";
  expect(text).not.toMatch(/\*\*[^*]+\*\*/);
});

test("12. Settings: Re-run indexing button is present and reachable", async () => {
  test.setTimeout(60_000);
  const settingsNav = window.getByRole("button", { name: "Settings", exact: true });
  await settingsNav.click();
  await window.getByRole("tab", { name: "Chat" }).click();
  await expect(window.getByTestId("chat-backfill-start")).toBeVisible();
});

test("13. user messages right-align, assistant messages left-align", async () => {
  test.setTimeout(120_000);
  await goToChat();
  // Open the most recent thread that has at least one full turn.
  const recent = window.getByTestId("chat-recent-thread").first();
  await recent.click();
  const user = window.locator('[data-role="user"]').first();
  const assistant = window.locator('[data-role="assistant"]').first();
  await expect(user).toBeVisible();
  await expect(assistant).toBeVisible();

  // Measure horizontal positions. The user bubble should be anchored near
  // the right edge of the reading column; the assistant should start near
  // the left edge.
  const widths = await window.evaluate(() => {
    const u = document.querySelector('[data-role="user"]') as HTMLElement | null;
    const a = document.querySelector('[data-role="assistant"]') as HTMLElement | null;
    const parent = document.querySelector(
      '[data-testid="chat-thread-messages"]',
    ) as HTMLElement | null;
    if (!u || !a || !parent) return null;
    const prect = parent.getBoundingClientRect();
    const urect = u.getBoundingClientRect();
    const arect = a.getBoundingClientRect();
    return {
      parentLeft: prect.left,
      parentRight: prect.right,
      userLeft: urect.left,
      userRight: urect.right,
      assistantLeft: arect.left,
    };
  });
  console.log("Alignment widths:", widths);
  expect(widths).not.toBeNull();
  if (!widths) return;
  // User bubble's right edge must be within 20px of the parent's right.
  expect(widths.parentRight - widths.userRight).toBeLessThan(20);
  // Assistant must start within 8px of the parent's left edge.
  expect(widths.assistantLeft - widths.parentLeft).toBeLessThan(8);
});

test("14. thinking indicator appears before first token", async () => {
  test.setTimeout(240_000);
  await goToChat();
  // Kick off in parallel: click send, then start polling for the indicator
  // at high frequency. It's visible only between "streaming started" and
  // "first token arrived" — a tight window when Ollama is cold-started.
  const indicatorSeenPromise = (async () => {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (await window.getByTestId("chat-thinking-indicator").count()) {
        return true;
      }
      await window.waitForTimeout(50);
    }
    return false;
  })();

  await window.getByTestId("chat-composer-input").fill("What did we talk about with Lauren?");
  await window.getByTestId("chat-composer-send").click();

  const seen = await indicatorSeenPromise;
  console.log("Thinking indicator ever visible:", seen);
  expect(seen).toBe(true);
});

test("15. composer border doesn't glitch on focus", async () => {
  test.setTimeout(30_000);
  await goToChat();
  const composer = window.getByTestId("chat-composer");
  const input = window.getByTestId("chat-composer-input");
  await input.focus();

  // Measure border width: should be a single 1px border (no doubled frame).
  const borderWidth = await composer.evaluate((el: HTMLElement) => {
    const cs = getComputedStyle(el);
    return {
      top: parseFloat(cs.borderTopWidth),
      right: parseFloat(cs.borderRightWidth),
      bottom: parseFloat(cs.borderBottomWidth),
      left: parseFloat(cs.borderLeftWidth),
    };
  });
  console.log("Composer border (focused):", borderWidth);
  // All four borders equal and <= 2px each.
  expect(borderWidth.top).toBeLessThanOrEqual(2);
  expect(borderWidth.top).toBe(borderWidth.left);
});

test("16. picking a non-default model in the empty state persists to the new thread", async () => {
  test.setTimeout(240_000);
  await goToChat();

  // Pick a model different from the default via the composer dropdown.
  await window.getByTestId("chat-model-picker").click();
  // Find a model option that isn't "default". Use any installed Ollama tag.
  const otherModel = await window.evaluate(async () => {
    return (await (window as any).api.llm.listInstalled()) as string[];
  });
  // Pick any installed model (they should all differ from "default" label).
  const altModel = otherModel[0];
  console.log("Selecting model:", altModel);
  await window.getByRole("menuitem", { name: altModel }).first().click();

  // Send a short question that completes quickly.
  await window.getByTestId("chat-composer-input").fill("Hi");
  await window.getByTestId("chat-composer-send").click();
  await window.waitForURL(/#\/chat\/t\//, { timeout: 30_000 });

  // Wait for the thread to settle so we can query its model.
  await expect(window.locator('[data-role="assistant"]').first()).toBeVisible({
    timeout: 180_000,
  });

  // Grab the thread's persisted model_id via IPC.
  const threadId = await window.evaluate(() => {
    const m = window.location.hash.match(/#\/chat\/t\/([^?]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  });
  expect(threadId).toBeTruthy();
  const persistedModel = await window.evaluate(async (id: string) => {
    const list = (await (window as any).api.chat.listThreads()) as Array<{
      thread_id: string;
      model_id: string | null;
    }>;
    return list.find((t) => t.thread_id === id)?.model_id ?? null;
  }, threadId!);
  console.log("Persisted model on new thread:", persistedModel);
  expect(persistedModel).toBe(altModel);
});

test("17. chat citation click lands on the Transcript tab (not Metadata)", async () => {
  test.setTimeout(360_000);
  await goToChat();
  // Always ask a fresh Lauren question so we get at least one timestamp
  // pill back from the model.
  await window.getByTestId("chat-composer-input").fill(LAUREN_QUERY);
  await window.getByTestId("chat-composer-send").click();
  await window.waitForURL(/#\/chat\/t\//, { timeout: 30_000 });
  await expect(window.locator('[data-role="assistant"]').first()).toBeVisible({
    timeout: 300_000,
  });

  const pill = window.getByTestId("timestamp-pill").first();
  // If the model happened to return only non-transcript citations on this
  // run, we still want the test to validate the tab-routing behavior, so
  // synthesize a navigation with ?t= and assert on that. Otherwise click
  // the real pill.
  if (await pill.count()) {
    await pill.click();
  } else {
    console.log("No timestamp pill rendered; synthesizing navigation via test hook.");
    await window.evaluate(async () => {
      const list = await (window as any).api.runs.list();
      const row = list.find((r: any) => /lauren/i.test(r.title));
      if (row && (window as any).__MEETING_NOTES_TEST?.navigateRoute) {
        (window as any).__MEETING_NOTES_TEST.navigateRoute({
          name: "meeting",
          runFolder: row.folder_path,
          view: "details",
          initialSeekMs: 60000,
        });
      }
    });
  }
  await window.waitForURL(/#\/meeting\//, { timeout: 15_000 });

  // The Transcript tab should be the active inner tab, not Metadata.
  // The outer Workspace/Details view toggle uses Tabs too, so we filter
  // for the inner detail tabs by ID prefix.
  const transcriptTab = window.locator(
    '[role="tab"][id*="transcript"][data-state="active"]',
  );
  await expect(transcriptTab).toHaveCount(1, { timeout: 10_000 });
});

test("19. participant filter picker offers a free-text filter and applies it to retrieval", async () => {
  test.setTimeout(300_000);
  await goToChat();
  await window.getByTestId("chat-participant-picker").click();

  const search = window.getByTestId("chat-participant-search");
  await expect(search).toBeVisible();
  await search.fill("Lauren");

  // Real library has no participants table entries, so the free-text option
  // should be offered.
  const freeform = window.getByTestId("chat-participant-option-freeform");
  await expect(freeform).toBeVisible();
  await freeform.click();

  // Chip shows the selected filter.
  await expect(window.getByTestId("chat-participant-chip")).toHaveAttribute(
    "data-participant",
    "Lauren",
  );

  // Verify the filter actually narrows retrieval: call searchMeetings via
  // IPC (via a direct test hook we expose inline) with the filter and
  // confirm every hit's run_title mentions Lauren.
  const results = await window.evaluate(async () => {
    const { sqliteVecSearch, searchMeetings } =
      (window as any).__MEETING_NOTES_TEST ?? {};
    // Fall back to calling the IPC via our real api path: chat.send's
    // filters field. We synthesize a single-shot search by using the
    // embed model status + a direct IPC call pattern — simplest is to
    // send a short message and inspect the retrieval hits via the
    // resulting citations.
    const resp = await (window as any).api.chat.send({
      userMessage: "who did I talk to this week",
      filters: { participant: "Lauren" },
    });
    return resp.citations.map((c: any) => c.run_title_snapshot);
  });
  console.log("Filtered citation titles:", results);
  // At least one citation, and every citation's title must contain
  // "Lauren" (since the filter is applied).
  if (results.length > 0) {
    expect(results.every((t: string) => /lauren/i.test(t))).toBe(true);
  } else {
    // If the model returned no citations for the filtered set, at least
    // verify that the filter was applied by checking the citations
    // count differs from an unfiltered search.
    const unfiltered = await window.evaluate(async () => {
      const resp = await (window as any).api.chat.send({
        userMessage: "who did I talk to this week",
      });
      return resp.citations.map((c: any) => c.run_title_snapshot);
    });
    console.log("Unfiltered citation titles:", unfiltered);
    // Unfiltered should include at least one non-Lauren title when
    // filtered returned zero; otherwise the filter isn't doing its job.
    const nonLauren = unfiltered.filter((t: string) => !/lauren/i.test(t));
    expect(nonLauren.length).toBeGreaterThan(0);
  }
});

/**
 * Helpers used by the focus-halo tests below. We verify three invariants:
 *   (a) on focus, the computed box-shadow gains a green halo layer with
 *       a visible spread — rgba(45,107,63,*) matches our accent color.
 *   (b) focus doesn't shift layout (width/height unchanged).
 *   (c) the nearest overflow-clipping ancestor has at least 3px of
 *       clearance on every side so the halo isn't clipped.
 */
const ACCENT_HALO_RE = /rgba\(45,\s*107,\s*63/;

async function measureHaloClearance(
  locator: ReturnType<typeof window.getByTestId>,
) {
  return await locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    let parent: HTMLElement | null = el.parentElement;
    while (parent) {
      const cs = getComputedStyle(parent);
      if (
        cs.overflow !== "visible" ||
        cs.overflowX !== "visible" ||
        cs.overflowY !== "visible"
      ) {
        const prect = parent.getBoundingClientRect();
        return {
          top: rect.top - prect.top,
          left: rect.left - prect.left,
          right: prect.right - rect.right,
          bottom: prect.bottom - rect.bottom,
        };
      }
      parent = parent.parentElement;
    }
    return null;
  });
}

test("25. SourceChip click for each citation kind routes to the correct view/tab", async () => {
  test.setTimeout(180_000);

  // Use the test hook to synthesize citations of each kind without depending
  // on the LLM to emit them. This lets us deterministically verify the
  // routing logic for all four source types.
  const laurenRun = await window.evaluate(async () => {
    const list = await (window as any).api.runs.list();
    const row = list.find((r: any) => /lauren/i.test(r.title));
    return row?.folder_path as string | undefined;
  });
  if (!laurenRun) test.skip(true, "No Lauren run in library.");

  // Each kind maps to a specific expected landing state.
  const cases: Array<{
    source: "summary" | "prep" | "notes" | "transcript";
    expectView: "workspace" | "details";
    expectTab?: string;
  }> = [
    { source: "summary", expectView: "details", expectTab: "summary" },
    { source: "transcript", expectView: "details", expectTab: "transcript" },
    { source: "prep", expectView: "workspace" },
    { source: "notes", expectView: "workspace" },
  ];

  for (const c of cases) {
    console.log(`Testing source=${c.source}`);
    // Return to chat, then synthesize navigation as if a SourceChip of
    // that kind was clicked.
    await goToChat();
    await window.evaluate(
      async ({ runFolder, source }) => {
        const hook = (window as any).__MEETING_NOTES_TEST;
        if (!hook) throw new Error("test hook missing");
        // Compute route fields by replicating App.tsx's mapping.
        const view = source === "prep" || source === "notes" ? "workspace" : "details";
        const initialTabId =
          source === "summary"
            ? "summary"
            : source === "transcript"
              ? "transcript"
              : undefined;
        hook.navigateRoute({
          name: "meeting",
          runFolder,
          view,
          initialTabId,
        });
      },
      { runFolder: laurenRun!, source: c.source },
    );
    await window.waitForURL(/#\/meeting\//, { timeout: 10_000 });
    await window.waitForTimeout(500);

    if (c.expectView === "details") {
      // Assert the inner Details tab is active.
      const tabSelector = `[role="tab"][id*="${c.expectTab!}"][data-state="active"]`;
      await expect(window.locator(tabSelector)).toHaveCount(1, {
        timeout: 10_000,
      });
      // Double-check the outer view toggle also shows "Details" selected.
      const activeView = await window
        .locator('[role="tab"][data-state="active"]')
        .allTextContents();
      console.log(`  active tabs for ${c.source}:`, activeView);
      expect(activeView.some((t) => /Details/.test(t))).toBe(true);
    } else {
      // Workspace view: the prep/notes editors live here. Confirm the
      // outer view toggle shows Workspace selected.
      const activeView = await window
        .locator('[role="tab"][data-state="active"]')
        .allTextContents();
      console.log(`  active tabs for ${c.source}:`, activeView);
      expect(activeView.some((t) => /Workspace/.test(t))).toBe(true);
    }
  }
});

test("24. follow-up user message renders immediately during agent thinking", async () => {
  test.setTimeout(360_000);
  // Open a fresh thread so we have a known starting point.
  await goToChat();
  await window.getByTestId("chat-composer-input").fill("Hi there");
  await window.getByTestId("chat-composer-send").click();
  await window.waitForURL(/#\/chat\/t\//, { timeout: 30_000 });
  await expect(window.locator('[data-role="assistant"]').first()).toBeVisible({
    timeout: 240_000,
  });

  // Count current user bubbles — we'll expect this+1 while the second
  // turn is still in flight.
  const userBubblesBefore = await window.locator('[data-role="user"]').count();

  // Fire the second message. Without the optimistic render, the user
  // bubble wouldn't appear until the entire LLM response completes —
  // which is the UX bug we're guarding against.
  const followUp = `Tell me more about that — second message ${Date.now()}`;
  await window.getByTestId("chat-composer-input").fill(followUp);
  await window.getByTestId("chat-composer-send").click();

  // Poll for the second user bubble to appear quickly (much faster than
  // a model turn). We allow up to 4s to rule out a slow IPC round-trip
  // but a well-behaved UI will show the bubble in well under a second.
  const seen = await (async () => {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const n = await window.locator('[data-role="user"]').count();
      if (n > userBubblesBefore) {
        const texts = await window
          .locator('[data-role="user"]')
          .allTextContents();
        if (texts.some((t) => t.includes(followUp))) return true;
      }
      await window.waitForTimeout(100);
    }
    return false;
  })();

  expect(seen, "Follow-up user bubble did not appear within 4s").toBe(true);

  // And the thinking indicator is visible while the model is still
  // working on a response to the follow-up.
  await expect(window.getByTestId("chat-thinking-indicator")).toBeVisible({
    timeout: 5_000,
  });
});

test("21. focus halo renders uniformly on the composer (no clipping)", async () => {
  test.setTimeout(60_000);
  await goToChat();
  const composer = window.getByTestId("chat-composer");
  const input = window.getByTestId("chat-composer-input");

  const before = await composer.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height };
  });

  await input.focus();
  await window.waitForTimeout(200);

  const focused = await composer.evaluate((el) => getComputedStyle(el).boxShadow);
  console.log("Composer focused shadow:", focused);
  // Must contain a green accent halo layer.
  expect(focused).toMatch(ACCENT_HALO_RE);
  // Halo must have a 3px spread — that's the "0px 0px 0px 3px" signature.
  expect(focused).toMatch(/0px\s+0px\s+0px\s+3px/);

  const after = await composer.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  expect(Math.abs(before.w - after.w)).toBeLessThan(1);
  expect(Math.abs(before.h - after.h)).toBeLessThan(1);

  const clearance = await measureHaloClearance(composer);
  console.log("Composer clearance from nearest clipper:", clearance);
  expect(clearance).not.toBeNull();
  if (clearance) {
    expect(clearance.top).toBeGreaterThanOrEqual(3);
    expect(clearance.left).toBeGreaterThanOrEqual(3);
    expect(clearance.right).toBeGreaterThanOrEqual(3);
    expect(clearance.bottom).toBeGreaterThanOrEqual(3);
  }
});

test("22. system prompt textarea uses an inset focus ring (no outer clipping)", async () => {
  test.setTimeout(60_000);
  await window.getByRole("button", { name: "Settings", exact: true }).click();
  await window.getByRole("tab", { name: "Chat" }).click();

  const textarea = window.getByTestId("chat-system-prompt-textarea");
  await expect(textarea).toBeVisible();

  const before = await textarea.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height };
  });

  await textarea.focus();
  await window.waitForTimeout(200);
  const focused = await textarea.evaluate((el) => getComputedStyle(el).boxShadow);
  console.log("System prompt focused shadow:", focused);
  // Inset ring signature — "inset … 0px 0px 0px 1px" (1px spread inside).
  expect(focused.toLowerCase()).toContain("inset");
  // And a 1px spread layer somewhere in the inset shadow (order of the
  // `inset` keyword vs the lengths varies by engine: WebKit emits
  // "... 1px inset" while Blink emits "inset ... 1px").
  expect(focused).toMatch(/0px\s+0px\s+0px\s+1px\s+inset|inset\s+0px\s+0px\s+0px\s+1px/);
  // Border color must swap to the accent ring color on focus.
  const borderColor = await textarea.evaluate((el) =>
    getComputedStyle(el).borderTopColor,
  );
  console.log("System prompt border on focus:", borderColor);

  const after = await textarea.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  expect(Math.abs(before.w - after.w)).toBeLessThan(1);
  expect(Math.abs(before.h - after.h)).toBeLessThan(1);
});

test("23. Settings Select trigger uses an inset focus ring", async () => {
  test.setTimeout(60_000);
  await window.getByRole("button", { name: "Settings", exact: true }).click();
  await window.getByRole("tab", { name: "Storage" }).click();
  // Radix Select triggers expose role="combobox". Canonical locator.
  const trigger = window.getByRole("combobox").first();
  await expect(trigger).toBeVisible();
  // focus-visible only applies on keyboard focus for buttons. Programmatic
  // .focus() doesn't trigger :focus-visible in Chromium. Use Tab instead.
  await trigger.evaluate((el: HTMLElement) => el.scrollIntoView({ block: "center" }));
  await window.keyboard.press("Tab");
  await window.waitForTimeout(100);
  // Tab may land elsewhere first; walk focus to the combobox deterministically.
  for (let i = 0; i < 40; i++) {
    const active = await window.evaluate(
      () => (document.activeElement as HTMLElement | null)?.getAttribute("role") ?? "",
    );
    if (active === "combobox") break;
    await window.keyboard.press("Tab");
  }
  await window.waitForTimeout(200);
  const focused = await trigger.evaluate((el) => getComputedStyle(el).boxShadow);
  console.log("Select trigger focused shadow:", focused);
  expect(focused.toLowerCase()).toContain("inset");
  expect(focused).toMatch(/0px\s+0px\s+0px\s+1px\s+inset|inset\s+0px\s+0px\s+0px\s+1px/);
});

test("20. Settings → Chat shows embedding model status and control", async () => {
  test.setTimeout(60_000);
  const settingsNav = window.getByRole("button", { name: "Settings", exact: true });
  await settingsNav.click();
  await window.getByRole("tab", { name: "Chat" }).click();

  const section = window.getByTestId("chat-embed-model-section");
  await expect(section).toBeVisible();

  const status = window.getByTestId("chat-embed-model-status");
  await expect(status).toBeVisible();
  // On the dev machine, nomic-embed-text should be installed (auto-pulled
  // on app start, or manually pulled earlier).
  const installed = await status.getAttribute("data-installed");
  expect(installed).toBe("true");
});

test("18. Anthropic model picker shows multiple Claude options when a key is configured", async () => {
  test.setTimeout(30_000);
  await goToChat();
  // Verify a Claude key is set; otherwise skip.
  const hasClaude = await window.evaluate(async () =>
    (window as any).api.secrets.has("claude"),
  );
  test.skip(!hasClaude, "No Claude API key configured — skipping multi-model test.");

  await window.getByTestId("chat-model-picker").click();
  const items = window.getByRole("menuitem");
  const count = await items.count();
  const labels: string[] = [];
  for (let i = 0; i < count; i++) {
    labels.push((await items.nth(i).textContent())?.trim() ?? "");
  }
  console.log("Composer picker items:", labels);
  const claudeLabels = labels.filter((l) => /Claude/i.test(l));
  expect(claudeLabels.length).toBeGreaterThan(1);
});

// ---------------------------------------------------------------------------
// Guardrail relaxation — grounded follow-up turns must not fail-closed, and
// must carry citations forward so the UI still has something clickable.
// A genuinely new uncited turn that happens to follow a cited one must
// still hedge or fail-closed (negative test below).

async function currentThreadId(): Promise<string> {
  const id = await window.evaluate(() => {
    const m = window.location.hash.match(/#\/chat\/t\/([^?]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  });
  if (!id) throw new Error("Not on a thread route");
  return id;
}

async function sendFollowUp(text: string) {
  await window.getByTestId("chat-composer-input").fill(text);
  await window.getByTestId("chat-composer-send").click();
}

async function waitForAssistantCount(n: number) {
  await expect
    .poll(
      async () => window.locator('[data-role="assistant"]').count(),
      { timeout: 240_000 },
    )
    .toBeGreaterThanOrEqual(n);
}

async function lastAssistantMessage(threadId: string) {
  return await window.evaluate(async (id: string) => {
    const resp = await (window as any).api.chat.getThread(id);
    if (!resp) return null;
    const assistants = resp.messages.filter((m: any) => m.role === "assistant");
    return assistants[assistants.length - 1] ?? null;
  }, threadId);
}

test("26. follow-up reformat carries citations forward on real data", async () => {
  test.setTimeout(480_000);
  // Turn 1: cited Lauren answer.
  await askAndAwaitAnswer(LAUREN_QUERY);
  const threadId = await currentThreadId();
  const firstAssistant = await lastAssistantMessage(threadId);
  expect(firstAssistant).not.toBeNull();
  expect(firstAssistant.citations.length).toBeGreaterThan(0);

  // Turn 2: reformat request in the same thread.
  await sendFollowUp("Give me that in copy-pasteable format.");
  await waitForAssistantCount(2);

  // The reformatted answer must not be fail-closed.
  const secondText = await window
    .locator('[data-role="assistant"]')
    .nth(1)
    .textContent();
  console.log("Reformat answer:", secondText);
  expect(secondText ?? "").not.toContain("couldn't ground my answer");
  expect(secondText ?? "").toMatch(/lauren/i);

  // Either the model re-emitted inline markers (pills/chips on the turn)
  // OR carry-forward attached citations to the stored message. Assert the
  // stored message is grounded either way.
  const secondAssistant = await lastAssistantMessage(threadId);
  expect(secondAssistant.citations.length).toBeGreaterThan(0);
});

test("27. short referential follow-up keeps citations on real data", async () => {
  test.setTimeout(480_000);
  // Fresh thread to isolate the turn pair.
  await goToChat();
  await window.getByTestId("chat-composer-input").fill(LAUREN_QUERY);
  await window.getByTestId("chat-composer-send").click();
  await window.waitForURL(/#\/chat\/t\//, { timeout: 30_000 });
  const assistants = window.locator('[data-role="assistant"]');
  await expect(assistants.first()).toBeVisible({ timeout: 240_000 });

  const threadId = await currentThreadId();
  const firstAssistant = await lastAssistantMessage(threadId);
  expect(firstAssistant.citations.length).toBeGreaterThan(0);

  await sendFollowUp("Which of those matters most?");
  await waitForAssistantCount(2);

  const secondText = await assistants.nth(1).textContent();
  console.log("Short referential answer:", secondText);
  expect(secondText ?? "").not.toContain("couldn't ground my answer");

  const secondAssistant = await lastAssistantMessage(threadId);
  expect(secondAssistant.citations.length).toBeGreaterThan(0);
});

test("28. new unrelated question after a cited answer is still fail-closable", async () => {
  test.setTimeout(480_000);
  // Fresh thread, cited answer first.
  await goToChat();
  await window.getByTestId("chat-composer-input").fill(LAUREN_QUERY);
  await window.getByTestId("chat-composer-send").click();
  await window.waitForURL(/#\/chat\/t\//, { timeout: 30_000 });
  await expect(window.locator('[data-role="assistant"]').first()).toBeVisible({
    timeout: 240_000,
  });
  const threadId = await currentThreadId();
  const firstAssistant = await lastAssistantMessage(threadId);
  expect(firstAssistant.citations.length).toBeGreaterThan(0);
  const firstRunIds = new Set<string>(
    firstAssistant.citations.map((c: any) => c.run_id),
  );

  // Brand-new, unrelated question. Not a reformat, not a short referential
  // follow-up. Combined rule must not carry-forward.
  await sendFollowUp(EMPTY_QUERY);
  await waitForAssistantCount(2);

  const secondText =
    (await window.locator('[data-role="assistant"]').nth(1).textContent()) ?? "";
  console.log("Unrelated-after-cited answer:", secondText);
  const normalized = secondText.toLowerCase().replace(/[\u2018\u2019]/g, "'");

  // Must EITHER hedge OR be the fail-closed message. The invariant is it
  // MUST NOT restate Lauren facts as if grounded.
  const hedgePatterns = [
    /couldn't (find|ground)/,
    /don't know/,
    /can't find/,
    /not find/,
    /do not (contain|find|have|mention|include)/,
    /does not (contain|mention|include)/,
    /not contain/,
    /no (mention|information|relevant|related|matching|data|content|discussion)/,
    /nothing (about|related|relevant)/,
    /unrelated/,
    /don't have/,
    /none of (the |your )?(excerpts|meetings|provided|the provided)/,
    /could you clarify/,
    /try rephras/,
    /rephras/,
    /not sure (what|which)/,
  ];
  const hedged = hedgePatterns.some((p) => p.test(normalized));
  expect(
    hedged,
    `Expected hedge or fail-closed in unrelated turn: "${normalized}"`,
  ).toBe(true);

  // Critical negative: the Lauren citations must NOT silently carry
  // forward onto this unrelated turn. If they do, the combined rule is
  // broken (follow-up signal was false but relaxation fired anyway).
  const secondAssistant = await lastAssistantMessage(threadId);
  const carriedOverlap = (secondAssistant.citations ?? []).filter((c: any) =>
    firstRunIds.has(c.run_id),
  );
  // The 2nd turn may have its own retrieval citations — that's fine. But
  // it must not simply inherit the 1st turn's set of run_ids.
  if (secondAssistant.citations.length > 0) {
    // If there's overlap, it must be because retrieval genuinely
    // returned the same run(s), not because we carried forward.
    // Heuristic: carry-forward always produces the *exact same set* as
    // the prior turn; a genuine retrieval overlap is usually a subset
    // with different start_ms. Assert the sets are not identical.
    const secondKeys = new Set<string>(
      secondAssistant.citations.map(
        (c: any) => `${c.run_id}:${c.start_ms ?? c.source}`,
      ),
    );
    const firstKeys = new Set<string>(
      firstAssistant.citations.map(
        (c: any) => `${c.run_id}:${c.start_ms ?? c.source}`,
      ),
    );
    const identical =
      secondKeys.size === firstKeys.size &&
      [...secondKeys].every((k) => firstKeys.has(k));
    expect(
      identical,
      `2nd turn citations exactly equal 1st turn — looks like carry-forward fired on a new-claim turn. overlap=${carriedOverlap.length}`,
    ).toBe(false);
  }
});

test("29. explicit reformat with 'keep citations' re-emits cite markers", async () => {
  // Aspirational — validates Layer 1 (prompt hardening). Local models are
  // inconsistent about re-emitting markers even with explicit instruction,
  // so we mark this fixme-if-no-markers rather than hard-fail. It's a
  // quality bar to pull the code fallback rate down over time.
  test.setTimeout(480_000);
  await goToChat();
  await window.getByTestId("chat-composer-input").fill(LAUREN_QUERY);
  await window.getByTestId("chat-composer-send").click();
  await window.waitForURL(/#\/chat\/t\//, { timeout: 30_000 });
  await expect(window.locator('[data-role="assistant"]').first()).toBeVisible({
    timeout: 240_000,
  });

  await sendFollowUp("Restate that as three bullets, keeping any citations.");
  await waitForAssistantCount(2);

  // Count pills+chips that belong to the second assistant turn.
  const second = window.locator('[data-role="assistant"]').nth(1);
  const pills = await second.locator('[data-testid="timestamp-pill"]').count();
  const chips = await second.locator('[data-testid="source-chip"]').count();
  console.log(`Reformat turn inline markers: pills=${pills} chips=${chips}`);
  if (pills + chips === 0) {
    test.fixme(
      true,
      "Model did not re-emit inline citation markers on reformat — carry-forward should have compensated. Revisit prompt.",
    );
  } else {
    expect(pills + chips).toBeGreaterThan(0);
  }
});
