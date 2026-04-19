import { test, expect } from "../fixtures/base.fixture";
import type { Page } from "@playwright/test";

const RUN_FOLDER = "/runs/weekly-planning";
const SUMMARY_KEY = `${RUN_FOLDER}|summary.md`;
const TRANSCRIPT_KEY = `${RUN_FOLDER}|transcript.md`;
const NOTES_KEY = `${RUN_FOLDER}|notes.md`;

type Counts = { readDocument: Record<string, number> };

async function readCounts(page: Page): Promise<Counts> {
  return page.evaluate(() => {
    const w = window as unknown as { __ipcCallCounts?: Counts };
    return {
      readDocument: { ...(w.__ipcCallCounts?.readDocument ?? {}) },
    };
  });
}

test.describe("Meeting detail prefetch + caching", () => {
  test.beforeEach(async ({ app, meetingsList, meetingWorkspace }) => {
    await app.navigateTo("Meetings");
    await meetingsList.waitForReady();
    await meetingsList.meetingRow("Weekly planning").click();
    await meetingWorkspace.waitForReady({ view: "details" });
  });

  test("prefetches summary + transcript on meeting open (no tab click required)", async ({
    page,
  }) => {
    // Prefetch fires once detail + prompts resolve. Poll briefly for both
    // keys to appear in the counter; if the prefetch effect never runs the
    // expect() below fails fast.
    await expect
      .poll(async () => {
        const c = await readCounts(page);
        return [c.readDocument[SUMMARY_KEY] ?? 0, c.readDocument[TRANSCRIPT_KEY] ?? 0];
      }, { timeout: 2000, intervals: [50, 100, 200] })
      .toEqual([1, 1]);

    // Notes is read on meeting open as part of the Workspace data; summary
    // and transcript are the only *tab* prefetches. Sanity check that
    // analysis prompt outputs are NOT prefetched (would be /prompt:*/ keys).
    const c = await readCounts(page);
    const analysisKeys = Object.keys(c.readDocument).filter((k) =>
      k.startsWith(`${RUN_FOLDER}|`) && k !== SUMMARY_KEY && k !== TRANSCRIPT_KEY && k !== NOTES_KEY,
    );
    expect(analysisKeys).toEqual([]);
  });

  test("Summary + Transcript tab clicks are instant (cache hit, no new IPC)", async ({
    meetingWorkspace,
    page,
  }) => {
    // Wait until prefetch has populated both caches.
    await expect
      .poll(async () => (await readCounts(page)).readDocument[SUMMARY_KEY] ?? 0, {
        timeout: 2000,
      })
      .toBe(1);
    await expect
      .poll(async () => (await readCounts(page)).readDocument[TRANSCRIPT_KEY] ?? 0, {
        timeout: 2000,
      })
      .toBe(1);

    const before = await readCounts(page);

    // Summary tab — content should paint without any new readDocument call.
    const summaryStart = Date.now();
    await meetingWorkspace.tab("Summary").click();
    await expect(page.getByText("Highlights")).toBeVisible();
    const summaryElapsed = Date.now() - summaryStart;

    // Transcript tab — same.
    const transcriptStart = Date.now();
    await meetingWorkspace.tab("Transcript").click();
    await expect(page.getByText("Welcome everyone.")).toBeVisible();
    const transcriptElapsed = Date.now() - transcriptStart;

    const after = await readCounts(page);

    // Call counts must not increase — prefetch + in-flight dedupe means
    // clicking an already-populated tab never dispatches another IPC.
    expect(after.readDocument[SUMMARY_KEY]).toBe(before.readDocument[SUMMARY_KEY]);
    expect(after.readDocument[TRANSCRIPT_KEY]).toBe(before.readDocument[TRANSCRIPT_KEY]);

    // Timing sanity check: cached tab switches should be well under 500ms.
    // (Playwright's own click + visibility check overhead is ~50-150ms; we
    // pick a generous bound to avoid flakes on slow CI while still catching
    // regressions where a tab click triggers a fresh fetch.)
    expect(summaryElapsed).toBeLessThan(500);
    expect(transcriptElapsed).toBeLessThan(500);
  });

  test("analysis prompt outputs are NOT prefetched but are cached after first click", async ({
    meetingWorkspace,
    page,
  }) => {
    // Wait for initial prefetch to settle so the baseline is clean.
    await expect
      .poll(async () => (await readCounts(page)).readDocument[SUMMARY_KEY] ?? 0, {
        timeout: 2000,
      })
      .toBe(1);

    const beforeAnalysis = await readCounts(page);
    const analysisKeysBefore = Object.keys(beforeAnalysis.readDocument).filter(
      (k) => k.startsWith(`${RUN_FOLDER}|`) && k.endsWith(".md") &&
        k !== SUMMARY_KEY && k !== TRANSCRIPT_KEY && k !== NOTES_KEY,
    );
    expect(analysisKeysBefore, "no prompt outputs should be prefetched").toEqual([]);

    // Selecting the Decision Log prompt triggers exactly one readDocument
    // for decision-log.md. (Other prompts may also load — e.g. an
    // auto-selected default — but the contract we care about here is that
    // the *explicitly-selected* prompt is fetched once and cached.)
    await meetingWorkspace.tab("Analysis").click();
    await meetingWorkspace.promptSidebarItem("Decision Log").click();
    await expect(page.getByRole("heading", { name: "Decisions" })).toBeVisible();

    const decisionLogKey = `${RUN_FOLDER}|decision-log.md`;
    const afterFirstClick = await readCounts(page);
    expect(afterFirstClick.readDocument[decisionLogKey]).toBe(1);

    // Re-selecting the same prompt after navigating away must not refetch.
    await meetingWorkspace.tab("Summary").click();
    await expect(page.getByText("Highlights")).toBeVisible();
    await meetingWorkspace.tab("Analysis").click();
    await meetingWorkspace.promptSidebarItem("Decision Log").click();
    await expect(page.getByRole("heading", { name: "Decisions" })).toBeVisible();

    const afterSecondClick = await readCounts(page);
    expect(afterSecondClick.readDocument[decisionLogKey]).toBe(1);
  });

  test("rapid tab toggling does not duplicate IPC calls (in-flight dedupe)", async ({
    meetingWorkspace,
    page,
  }) => {
    // Toggle tabs fast before prefetch settles. Each tab's content must end
    // up loaded exactly once — even though multiple dispatchers (prefetch
    // effect + tab-loader effect) race for the same cache key.
    await meetingWorkspace.tab("Summary").click();
    await meetingWorkspace.tab("Transcript").click();
    await meetingWorkspace.tab("Summary").click();
    await meetingWorkspace.tab("Transcript").click();
    await expect(page.getByText("Welcome everyone.")).toBeVisible();

    const counts = await readCounts(page);
    expect(counts.readDocument[SUMMARY_KEY]).toBe(1);
    expect(counts.readDocument[TRANSCRIPT_KEY]).toBe(1);
  });
});
