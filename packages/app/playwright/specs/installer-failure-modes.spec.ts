import { test, expect } from "../fixtures/setup-wizard.fixture";

// Phase 2 swapped the brew wrapper for a direct-download installer
// pipeline (download → SHA-256 → extract → codesign → atomic swap →
// verifyExec). This spec exercises the failure path the real pipeline
// can hit, surfaced through the wizard UI:
//
//   - SHA-256 mismatch ("verify-checksum" phase)
//   - network failure ("download" phase)
//   - extraction failure ("extract" phase)
//   - verifyExec failure ("verify-exec" phase)
//
// We don't drive a real download here — the mock IPC surfaces a
// canned failure result via `__MEETING_NOTES_TEST.setNextInstallFailure`.
// The point is to lock the renderer's UX contract:
//
//   1. The error message includes the failedPhase in [brackets].
//   2. The Install button stays clickable so the user can retry.
//   3. Retry after a transient failure picks up the happy path
//      (the install-failure override is one-shot).

test.describe("Installer failure modes", () => {
  test("verify-checksum failure surfaces the phase + allows retry", async ({
    wizard,
    page,
  }) => {
    // Start with ffmpeg missing so the wizard offers Install ffmpeg.
    await page.evaluate(() => {
      (window as any).__MEETING_NOTES_TEST.setDependencyState({
        ffmpeg: null,
      });
      (window as any).__MEETING_NOTES_TEST.setNextInstallFailure("ffmpeg", {
        ok: false,
        error:
          "SHA-256 mismatch: expected aaaabbbbccccdddd, got 0000111122223333",
        failedPhase: "verify-checksum",
      });
    });

    // Walk to the dependencies step.
    await wizard.getStartedButton().click();
    await wizard.nextButton().click(); // data dir
    await wizard.nextButton().click(); // transcription
    await wizard.llmProviderSelect().click();
    await page.getByRole("option", { name: /Anthropic Claude/ }).click();
    await wizard.apiKeyInput().fill("sk-ant-test-key");
    await wizard.nextButton().click(); // deps

    // Click Install ffmpeg → mock returns the canned failure.
    await wizard.installButton("Install ffmpeg").click();

    // Error must surface BOTH the failed phase (so the user knows what
    // step blew up) and the underlying message. The phase + message
    // appear in two places (live install log + final error banner) —
    // .first() picks one, which is enough to assert the contract.
    await expect(
      page.getByText(/Install failed \[verify-checksum\]/).first()
    ).toBeVisible();
    await expect(page.getByText(/SHA-256 mismatch/).first()).toBeVisible();

    // The Install button stays clickable — failure does NOT permanently
    // disable the row. The override is one-shot, so a retry click hits
    // the happy path and the row goes from missing → ready.
    await wizard.installButton("Install ffmpeg").click();

    // The wizard's depsCheck refresh after install should show ffmpeg
    // as resolved (mock sets path on success). The (system) badge is
    // visible once the row reports ready.
    await expect(page.getByText(/\(system\)/)).toBeVisible();
  });

  test("network failure during download is reported with the right phase", async ({
    wizard,
    page,
  }) => {
    await page.evaluate(() => {
      (window as any).__MEETING_NOTES_TEST.setDependencyState({
        ffmpeg: null,
      });
      (window as any).__MEETING_NOTES_TEST.setNextInstallFailure("ffmpeg", {
        ok: false,
        error: "Connection timeout (30s) connecting to evermeet.cx",
        failedPhase: "download",
      });
    });

    await wizard.getStartedButton().click();
    await wizard.nextButton().click();
    await wizard.nextButton().click();
    await wizard.llmProviderSelect().click();
    await page.getByRole("option", { name: /Anthropic Claude/ }).click();
    await wizard.apiKeyInput().fill("sk-ant-test-key");
    await wizard.nextButton().click();

    await wizard.installButton("Install ffmpeg").click();

    await expect(
      page.getByText(/Install failed \[download\]/).first()
    ).toBeVisible();
    await expect(page.getByText(/Connection timeout/).first()).toBeVisible();
  });

  test("verify-exec failure surfaces the phase", async ({ wizard, page }) => {
    // verify-exec is the "downloaded fine, segfaults" case. Real users
    // hit this when an arch-mismatched or corrupt binary lands.
    await page.evaluate(() => {
      (window as any).__MEETING_NOTES_TEST.setDependencyState({
        ffmpeg: null,
      });
      (window as any).__MEETING_NOTES_TEST.setNextInstallFailure("ffmpeg", {
        ok: false,
        error: "expected exit 0, got null (signal SIGKILL)",
        failedPhase: "verify-exec",
      });
    });

    await wizard.getStartedButton().click();
    await wizard.nextButton().click();
    await wizard.nextButton().click();
    await wizard.llmProviderSelect().click();
    await page.getByRole("option", { name: /Anthropic Claude/ }).click();
    await wizard.apiKeyInput().fill("sk-ant-test-key");
    await wizard.nextButton().click();

    await wizard.installButton("Install ffmpeg").click();

    await expect(
      page.getByText(/Install failed \[verify-exec\]/).first()
    ).toBeVisible();
  });

  test("Parakeet auto-chain ffmpeg sub-step failure surfaces the phase", async ({
    wizard,
    page,
  }) => {
    // The setup-asr IPC handler now does ffmpeg + ffprobe + Python +
    // venv + smoke test all in one click. If any installer sub-step
    // fails, the renderer must show `[<phase>]:` from the chain's
    // {ok,error,failedPhase} return shape — same UX as deps:install.
    await page.evaluate(() => {
      (window as any).__MEETING_NOTES_TEST.setDependencyState({
        ffmpeg: null,
        parakeet: null,
      });
      (window as any).__MEETING_NOTES_TEST.setNextSetupAsrFailure({
        error: "ffmpeg bundle install failed: SHA-256 mismatch on evermeet.cx zip",
        failedPhase: "verify-checksum",
        logLines: [
          "→ ensuring ffmpeg + ffprobe",
          "  ffmpeg download: 12.3 MB / 25.4 MB",
          "  ✘ ffmpeg: SHA-256 mismatch",
        ],
      });
    });

    await wizard.getStartedButton().click();
    await wizard.nextButton().click();
    await wizard.nextButton().click();
    await wizard.llmProviderSelect().click();
    await page.getByRole("option", { name: /Anthropic Claude/ }).click();
    await wizard.apiKeyInput().fill("sk-ant-test-key");
    await wizard.nextButton().click();

    await wizard.installButton("Install Parakeet").click();

    await expect(
      page.getByText(/Install failed \[verify-checksum\]/).first()
    ).toBeVisible();
    await expect(
      page.getByText(/ffmpeg bundle install failed/).first()
    ).toBeVisible();
    // Sub-step log lines surface in the install pane so the user can see
    // exactly which step inside the chain blew up.
    await expect(
      page.getByText(/ensuring ffmpeg \+ ffprobe/).first()
    ).toBeVisible();
  });
});
