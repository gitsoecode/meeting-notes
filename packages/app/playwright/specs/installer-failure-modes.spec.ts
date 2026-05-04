import { test, expect } from "../fixtures/setup-wizard.fixture";

// The wizard's chain-install Dependencies step (v0.1.10) surfaces install
// pipeline failures inline on the failed row instead of a separate panel.
// These specs lock the renderer's UX contract per failure phase:
//
//   1. The error message includes the failedPhase in [brackets] so the
//      user knows what step blew up (download / verify-checksum /
//      verify-exec / extract).
//   2. The chain pauses on the failed row; later rows stay Pending.
//   3. Retry resumes from the failed row (the install-failure override is
//      one-shot, so the retry hits the happy path).

test.describe("Installer failure modes", () => {
  test("verify-checksum failure surfaces the phase + Retry resumes", async ({
    wizard,
    page,
  }) => {
    await page.evaluate(() => {
      (window as any).__MEETING_NOTES_TEST.setDependencyState({
        ffmpeg: null,
        ffprobe: null,
      });
      (window as any).__MEETING_NOTES_TEST.setNextInstallFailure("ffmpeg", {
        ok: false,
        error:
          "SHA-256 mismatch: expected aaaabbbbccccdddd, got 0000111122223333",
        failedPhase: "verify-checksum",
      });
    });

    await wizard.getStartedButton().click();
    await wizard.nextButton().click();
    await wizard.nextButton().click();
    await wizard.llmProviderSelect().click();
    await page.getByRole("option", { name: /Anthropic Claude/ }).click();
    await wizard.apiKeyInput().fill("sk-ant-test-key");
    await wizard.nextButton().click(); // permissions
    await wizard.advanceFromPermissionsToDeps();

    await wizard.installAllButton().click();

    // Failure surfaces on the ffmpeg row with the phase label.
    await expect(wizard.depRow("ffmpeg")).toHaveAttribute("data-state", "failed", {
      timeout: 5000,
    });
    await expect(wizard.depRowError("ffmpeg")).toContainText(
      /Install failed \[verify-checksum\]/,
    );
    await expect(wizard.depRowError("ffmpeg")).toContainText(/SHA-256 mismatch/);

    // Retry — override is one-shot, install succeeds.
    await wizard.chainRetryButton().click();
    await expect(wizard.depRow("ffmpeg")).toHaveAttribute("data-state", "done", {
      timeout: 5000,
    });
  });

  test("network failure during download is reported with the right phase", async ({
    wizard,
    page,
  }) => {
    await page.evaluate(() => {
      (window as any).__MEETING_NOTES_TEST.setDependencyState({
        ffmpeg: null,
        ffprobe: null,
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
    await wizard.nextButton().click(); // permissions
    await wizard.advanceFromPermissionsToDeps();

    await wizard.installAllButton().click();

    await expect(wizard.depRowError("ffmpeg")).toContainText(
      /Install failed \[download\]/,
      { timeout: 5000 },
    );
    await expect(wizard.depRowError("ffmpeg")).toContainText(/Connection timeout/);
  });

  test("verify-exec failure surfaces the phase", async ({ wizard, page }) => {
    // verify-exec is the "downloaded fine, segfaults" case. Real users
    // hit this when an arch-mismatched or corrupt binary lands.
    await page.evaluate(() => {
      (window as any).__MEETING_NOTES_TEST.setDependencyState({
        ffmpeg: null,
        ffprobe: null,
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
    await wizard.nextButton().click(); // permissions
    await wizard.advanceFromPermissionsToDeps();

    await wizard.installAllButton().click();

    await expect(wizard.depRowError("ffmpeg")).toContainText(
      /Install failed \[verify-exec\]/,
      { timeout: 5000 },
    );
  });

  test("Parakeet auto-chain ffmpeg sub-step failure surfaces the phase", async ({
    wizard,
    page,
  }) => {
    // The setup-asr IPC handler does ffmpeg + ffprobe + Python + venv +
    // smoke test in one call. If any sub-step fails, the wizard surfaces
    // `[<phase>]:` on the Parakeet row from the chain's {ok,error,
    // failedPhase} return shape.
    await page.evaluate(() => {
      (window as any).__MEETING_NOTES_TEST.setDependencyState({
        ffmpeg: null,
        ffprobe: null,
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
      // Make ffmpeg dispatcher a no-op success so the chain reaches the
      // parakeet row (which is what we want to fail).
    });

    await wizard.getStartedButton().click();
    await wizard.nextButton().click();
    await wizard.nextButton().click();
    // Default ASR is parakeet-mlx; default LLM is Ollama. No keys needed.
    await wizard.nextButton().click(); // permissions
    await wizard.advanceFromPermissionsToDeps();

    await wizard.installAllButton().click();

    await expect(wizard.depRow("parakeet")).toHaveAttribute(
      "data-state",
      "failed",
      { timeout: 8000 },
    );
    await expect(wizard.depRowError("parakeet")).toContainText(
      /Install failed \[verify-checksum\]/,
    );
    await expect(wizard.depRowError("parakeet")).toContainText(
      /ffmpeg bundle install failed/,
    );
    // Sub-step log lines surface in the activity log.
    await wizard.activityLog().click();
    await expect(wizard.activityLog()).toContainText(/ensuring ffmpeg \+ ffprobe/);
  });
});
