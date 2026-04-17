import { test, expect } from "./fixtures/base.fixture";

// Weekly planning has an `audio/combined.wav` in the mock, so click-to-seek
// is wired. The transcript includes the line "Welcome everyone." at 00:00
// and "Sounds good to me." at 00:45.
const RUN_FOLDER = "/runs/weekly-planning";

test.describe("Transcript — search + click-to-seek", () => {
  test("click anywhere on a transcript line opens the pocket player and seeks", async ({
    app,
    meetingWorkspace,
    page,
  }) => {
    await app.navigateRoute({ name: "meeting", runFolder: RUN_FOLDER });
    await meetingWorkspace.waitForReady({ view: "details" });
    await meetingWorkspace.tab("Transcript").click();
    await expect(page.getByText("Welcome everyone.")).toBeVisible();

    // Pocket is hidden before the first click.
    const pocket = page.getByTestId("pocket-player");
    await expect(pocket).toHaveAttribute("data-state", "closed");

    // Clicking the line's TEXT (not just the tiny timestamp) must seek. The
    // line is rendered as a <button> so the whole row is the tap target.
    const line = page
      .getByRole("button", { name: /Play from 00:45/ })
      .first();
    await expect(line).toBeVisible();
    await line.click();

    await expect(pocket).toHaveAttribute("data-state", "open");

    // Plyr wrapped the audio and rendered its own controls.
    const plyrWrapper = pocket.locator(".plyr.plyr--audio");
    await expect(plyrWrapper).toBeVisible();

    // Audio src is set directly from the pre-loaded blob URL.
    const audio = pocket.locator("audio");
    await expect(audio).toHaveAttribute("src", /^blob:/);
  });

  test("dismiss × button closes the pocket", async ({
    app,
    meetingWorkspace,
    page,
  }) => {
    await app.navigateRoute({ name: "meeting", runFolder: RUN_FOLDER });
    await meetingWorkspace.waitForReady({ view: "details" });
    await meetingWorkspace.tab("Transcript").click();

    await page.getByRole("button", { name: /Play from 00:15/ }).first().click();
    const pocket = page.getByTestId("pocket-player");
    await expect(pocket).toHaveAttribute("data-state", "open");
    await pocket.getByRole("button", { name: "Close audio player" }).click();
    await expect(pocket).toHaveAttribute("data-state", "closed");
  });

  test("search bar expands on click, finds matches, and highlights them", async ({
    app,
    meetingWorkspace,
    page,
  }) => {
    await app.navigateRoute({ name: "meeting", runFolder: RUN_FOLDER });
    await meetingWorkspace.waitForReady({ view: "details" });
    await meetingWorkspace.tab("Transcript").click();
    await expect(page.getByText("Welcome everyone.")).toBeVisible();

    // Hidden by default.
    const collapsed = page.getByRole("button", { name: "Search transcript" });
    await collapsed.click();

    const input = page.getByPlaceholder("Search transcript…");
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();

    await input.fill("sprint");
    // Matches: "We need to lock the sprint scope."
    await expect(page.locator("mark", { hasText: "sprint" }).first()).toBeVisible();
    await expect(
      page.getByText("1 / 1", { exact: false }),
    ).toBeVisible();

    // Escape closes the bar and clears highlights.
    await input.press("Escape");
    await expect(input).toBeHidden();
  });

  test("recording tab hosts the unified player inline for combined.wav", async ({
    app,
    meetingWorkspace,
    page,
  }) => {
    await app.navigateRoute({ name: "meeting", runFolder: RUN_FOLDER });
    await meetingWorkspace.waitForReady({ view: "details" });
    await meetingWorkspace.tab("Recording").click();

    // The unified player portal target is marked with this data-testid.
    const inlineHost = page.getByTestId("playback-inline-host");
    await expect(inlineHost).toBeVisible();

    // Plyr wraps the shared audio element inside the inline host.
    const plyrWrapper = inlineHost.locator(".plyr.plyr--audio");
    await expect(plyrWrapper).toBeVisible();

    // Pocket-player is closed when the inline host is registered — one
    // player visible at a time, never two.
    const pocket = page.getByTestId("pocket-player");
    await expect(pocket).toHaveAttribute("data-state", "closed");
  });

  test("timestamp click on transcript seeks the same player that's visible inline on the recording tab", async ({
    app,
    meetingWorkspace,
    page,
  }) => {
    await app.navigateRoute({ name: "meeting", runFolder: RUN_FOLDER });
    await meetingWorkspace.waitForReady({ view: "details" });
    await meetingWorkspace.tab("Transcript").click();

    await page.getByRole("button", { name: /Play from 00:45/ }).first().click();

    const pocket = page.getByTestId("pocket-player");
    await expect(pocket).toHaveAttribute("data-state", "open");

    // Switch to Recording — the same Plyr chrome moves into the inline host.
    await meetingWorkspace.tab("Recording").click();
    const inlineHost = page.getByTestId("playback-inline-host");
    await expect(inlineHost.locator(".plyr.plyr--audio")).toBeVisible();

    // Pocket disappears so we never see two players at once.
    await expect(pocket).toHaveAttribute("data-state", "closed");
  });

  test("meetings without combined.wav render timestamps as plain text", async ({
    app,
    meetingWorkspace,
    page,
  }) => {
    // Strip combined.wav from the weekly-planning fixture so the meeting
    // has a transcript but no combined-playback file. Navigate away and
    // back so MeetingShell refetches the run detail; its combined-audio
    // memo only reruns when runFolder changes.
    await app.removeDocument(RUN_FOLDER, "audio/combined.wav");
    await app.navigateRoute({ name: "meetings" });
    await app.navigateRoute({ name: "meeting", runFolder: RUN_FOLDER });
    await meetingWorkspace.waitForReady({ view: "details" });
    await meetingWorkspace.tab("Transcript").click();
    await expect(page.getByText("Welcome everyone.")).toBeVisible();

    await expect(
      page.getByText("Click-to-play is unavailable", { exact: false }),
    ).toBeVisible();

    // No "Play from ..." buttons exist when click-to-seek is unavailable.
    const anyPlayButton = page.getByRole("button", { name: /^Play from \d/ });
    expect(await anyPlayButton.count()).toBe(0);
  });
});
