import { test, expect } from "../fixtures/base.fixture";

type TabName = "Metadata" | "Summary" | "Analysis" | "Transcript" | "Recording" | "Files";

const TABS: TabName[] = ["Summary", "Transcript", "Analysis", "Recording", "Metadata"];
const ITERATIONS = 5;

function summarize(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return { median, p95, mean, min: sorted[0], max: sorted[sorted.length - 1] };
}

test.describe("Detail view tab-switch perf", () => {
  test.beforeEach(async ({ app, meetingsList, meetingWorkspace }) => {
    await app.navigateTo("Meetings");
    await meetingsList.waitForReady();
    await meetingsList.meetingRow("Weekly planning").click();
    await meetingWorkspace.waitForReady({ view: "details" });
  });

  test("measures time to paint each tab", async ({ meetingWorkspace, page }) => {
    // Warm up: click every tab once so lazy IPC reads and first mounts are done.
    for (const name of TABS) {
      await meetingWorkspace.tab(name).click();
      await expect(meetingWorkspace.tab(name)).toHaveAttribute("data-state", "active");
      // Give the tabpanel a tick to finish its first paint.
      await page.waitForTimeout(50);
    }

    const results: Record<string, ReturnType<typeof summarize>> = {};

    for (const name of TABS) {
      const samples: number[] = [];
      for (let i = 0; i < ITERATIONS; i++) {
        // Always leave to Metadata between samples so the target tab re-mounts
        // its content each time (closer to real-world switching feel).
        await meetingWorkspace.tab("Metadata").click();
        await expect(meetingWorkspace.tab("Metadata")).toHaveAttribute("data-state", "active");
        await page.waitForTimeout(30);

        const t0 = await page.evaluate(() => performance.now());
        await meetingWorkspace.tab(name).click();
        await expect(meetingWorkspace.tab(name)).toHaveAttribute("data-state", "active");
        // Wait for two animation frames so React commits + browser paints.
        const elapsed = await page.evaluate(
          (start) =>
            new Promise<number>((resolve) => {
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve(performance.now() - start)),
              );
            }),
          t0,
        );
        samples.push(elapsed);
      }
      results[name] = summarize(samples);
    }

    const rows = Object.entries(results).map(([tab, s]) => ({
      tab,
      median_ms: Number(s.median.toFixed(1)),
      p95_ms: Number(s.p95.toFixed(1)),
      mean_ms: Number(s.mean.toFixed(1)),
      min_ms: Number(s.min.toFixed(1)),
      max_ms: Number(s.max.toFixed(1)),
    }));
    console.log("\nTab-switch latency (ms) — %d samples per tab", ITERATIONS);
    console.table(rows);

    // Sanity bound — flag only an extreme regression. Real gating should be
    // done by eyeballing the console.table output, not this threshold.
    for (const [tab, s] of Object.entries(results)) {
      expect.soft(s.median, `${tab} median should be under 500ms`).toBeLessThan(500);
    }
  });
});
