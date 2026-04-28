import { test, expect, type Page } from "../fixtures/base.fixture";

// Settings → Meeting index health panel. Replaced the old "Re-run indexing"
// button with a status-driven panel:
//
//   - empty:    no completed meetings yet
//   - healthy:  every terminal run has chunks + (vec available) embeddings
//   - pending:  some runs have zero chunks → "Index pending meetings" button
//   - fts-only: vec available but some runs missing vec rows → "Re-embed" button
//   - no-vec:   vec extension not loaded → healthy text caveats semantic search
//   - running:  progress bar + disabled buttons while a backfill is in flight
//   - error:    backfill finished with errors → scope-attributed message
//
// The mock exposes setMeetingIndexHealth(partial) and
// emitMeetingIndexProgress(partial) helpers so each state can be driven
// without a real DB or Ollama daemon.

type HealthPartial = {
  totalRuns?: number;
  pendingRuns?: number;
  ftsOnlyRuns?: number;
  vecAvailable?: boolean;
};
type ProgressPartial = {
  state?: "idle" | "running" | "paused" | "complete" | "error";
  total?: number;
  completed?: number;
  errors?: number;
  scope?: "missing-chunks" | "missing-embeddings";
  currentRunFolder?: string | null;
};

declare global {
  interface Window {
    __MEETING_NOTES_TEST: {
      setMeetingIndexHealth: (partial: HealthPartial) => void;
      emitMeetingIndexProgress: (partial: ProgressPartial) => void;
    };
  }
}

async function setHealth(page: Page, partial: HealthPartial) {
  await page.evaluate((p) => {
    window.__MEETING_NOTES_TEST.setMeetingIndexHealth(p);
  }, partial);
}

async function emitProgress(page: Page, partial: ProgressPartial) {
  await page.evaluate((p) => {
    window.__MEETING_NOTES_TEST.emitMeetingIndexProgress(p);
  }, partial);
}

async function openMeetingIndexTab(page: Page) {
  await page.getByRole("tab", { name: "Meeting index" }).click();
  await expect(page.getByTestId("meeting-index-health")).toBeVisible();
}

test.describe("Settings — Meeting index health panel", () => {
  test.beforeEach(async ({ app }) => {
    await app.navigateTo("Settings");
  });

  test("empty: no completed meetings yet", async ({ page }) => {
    await setHealth(page, {
      totalRuns: 0,
      pendingRuns: 0,
      ftsOnlyRuns: 0,
      vecAvailable: true,
    });
    await openMeetingIndexTab(page);
    await expect(page.getByTestId("meeting-index-state-empty")).toBeVisible();
    await expect(page.getByTestId("meeting-index-backfill-start")).toHaveCount(0);
    await expect(page.getByTestId("meeting-index-reembed")).toHaveCount(0);
  });

  test("healthy with vec available", async ({ page }) => {
    await setHealth(page, {
      totalRuns: 4,
      pendingRuns: 0,
      ftsOnlyRuns: 0,
      vecAvailable: true,
    });
    await openMeetingIndexTab(page);
    const healthy = page.getByTestId("meeting-index-state-healthy");
    await expect(healthy).toBeVisible();
    await expect(healthy).toContainText("All 4 meetings are indexed and searchable.");
    await expect(page.getByTestId("meeting-index-backfill-start")).toHaveCount(0);
    await expect(page.getByTestId("meeting-index-reembed")).toHaveCount(0);
  });

  test("healthy without vec extension caveats semantic search", async ({ page }) => {
    await setHealth(page, {
      totalRuns: 2,
      pendingRuns: 0,
      ftsOnlyRuns: 0,
      vecAvailable: false,
    });
    await openMeetingIndexTab(page);
    const healthy = page.getByTestId("meeting-index-state-healthy");
    await expect(healthy).toContainText(
      "Semantic search is unavailable because sqlite-vec isn't loaded.",
    );
    // FTS-only state never appears when vec isn't available — even if the
    // mock had reported it, the panel suppresses it because there's no
    // useful repair action.
    await expect(page.getByTestId("meeting-index-state-fts-only")).toHaveCount(0);
  });

  test("pending: button kicks the missing-chunks backfill", async ({ page }) => {
    await setHealth(page, {
      totalRuns: 5,
      pendingRuns: 2,
      ftsOnlyRuns: 0,
      vecAvailable: true,
    });
    await openMeetingIndexTab(page);

    const pending = page.getByTestId("meeting-index-state-pending");
    await expect(pending).toContainText("2 of 5 meetings are not yet indexed.");

    // Click the button while it's still enabled, then drive the
    // progress events the way the real main process would.
    const startBtn = page.getByTestId("meeting-index-backfill-start");
    await startBtn.click();

    await emitProgress(page, {
      state: "running",
      total: 2,
      completed: 0,
      errors: 0,
      scope: "missing-chunks",
    });
    await expect(startBtn).toBeDisabled();
    await expect(page.getByTestId("meeting-index-progress")).toBeVisible();
    await expect(page.getByTestId("meeting-index-progress-message")).toContainText(
      "Indexing 0 / 2…",
    );

    // Mid-run progress tick.
    await emitProgress(page, { completed: 1 });
    await expect(page.getByTestId("meeting-index-progress-message")).toContainText(
      "Indexing 1 / 2…",
    );

    // Completion: panel refetches health (we update it to healthy first
    // so the refetch lands on the healthy branch).
    await setHealth(page, { pendingRuns: 0 });
    await emitProgress(page, { state: "complete", completed: 2 });
    await expect(page.getByTestId("meeting-index-state-healthy")).toBeVisible();
  });

  test("fts-only: re-embed button visible when vec rows are missing", async ({
    page,
  }) => {
    await setHealth(page, {
      totalRuns: 3,
      pendingRuns: 0,
      ftsOnlyRuns: 3,
      vecAvailable: true,
    });
    await openMeetingIndexTab(page);
    const fts = page.getByTestId("meeting-index-state-fts-only");
    await expect(fts).toContainText(
      "3 meetings are indexed for keyword only — semantic search is incomplete.",
    );
    await expect(page.getByTestId("meeting-index-reembed")).toBeVisible();
    // Healthy copy is suppressed when there's something to fix.
    await expect(page.getByTestId("meeting-index-state-healthy")).toHaveCount(0);
  });

  test("re-embed failure attributes the error to Ollama", async ({ page }) => {
    await setHealth(page, {
      totalRuns: 1,
      pendingRuns: 0,
      ftsOnlyRuns: 1,
      vecAvailable: true,
    });
    await openMeetingIndexTab(page);
    await page.getByTestId("meeting-index-reembed").click();

    // Drive a failed re-embed run: 1 run attempted, embedder stayed
    // down → errors=1, completed=0, state goes to "complete". The
    // panel must surface this as a failure even though state ===
    // "complete" (per-run best-effort backfill never flips to "error").
    await emitProgress(page, {
      state: "running",
      total: 1,
      completed: 0,
      errors: 0,
      scope: "missing-embeddings",
    });
    await emitProgress(page, { state: "complete", completed: 0, errors: 1 });

    const errMsg = page.getByTestId("meeting-index-progress-error");
    await expect(errMsg).toContainText(
      "Re-embed failed — Ollama is still unreachable. Start Ollama and try again.",
    );
    // FTS-only count stays — the failed run didn't fix anything.
    await expect(page.getByTestId("meeting-index-state-fts-only")).toBeVisible();
  });

  test("opening Settings mid-run picks up live progress immediately", async ({
    page,
  }) => {
    // Set both state-of-the-world (mid-run progress) and health BEFORE
    // navigating to the Meeting-index tab — exercises the on-mount
    // backfillStatus() seed call. Without that seed the panel would
    // appear blank until the next event arrives.
    await emitProgress(page, {
      state: "running",
      total: 4,
      completed: 1,
      errors: 0,
      scope: "missing-chunks",
    });
    await setHealth(page, {
      totalRuns: 4,
      pendingRuns: 3,
      ftsOnlyRuns: 0,
      vecAvailable: true,
    });

    await openMeetingIndexTab(page);
    await expect(page.getByTestId("meeting-index-progress-message")).toContainText(
      "Indexing 1 / 4…",
    );
    await expect(page.getByTestId("meeting-index-backfill-start")).toBeDisabled();
  });
});
