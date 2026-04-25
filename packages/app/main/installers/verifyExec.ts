/**
 * Final-step "does this thing actually run?" check for wizard-installed
 * binaries. Runs *after* SHA-256, signature, and atomic rename — at this
 * point the resolver could find the binary, so a corrupt or
 * arch-mismatched executable would silently break recording. This check
 * is the last gate.
 *
 * Constraints (every one is deliberate, listed for the next reader):
 *
 *   - `shell: false`                 No shell expansion. We control argv.
 *   - `env: { PATH: "/usr/bin:/bin" }`
 *                                    Sanitized — the binary cannot leak
 *                                    user PATH preferences into its own
 *                                    behavior. We don't pass through any
 *                                    other env (no LANG, no HOME) — most
 *                                    --version invocations don't need them.
 *   - Hard timeout via AbortController
 *                                    Hangs are failure. Doesn't matter
 *                                    why a binary hangs (signing, model
 *                                    load, network) — if it doesn't
 *                                    answer --version in `timeoutMs`,
 *                                    it's broken for our purposes.
 *   - stdout + stderr captured       Surfaced to the caller for logging
 *                                    via `deps-install:log` (the IPC
 *                                    layer pipes the result.output).
 *   - `expectExit` exact match       Some binaries exit non-zero on
 *                                    --help (e.g., ffmpeg). Manifest
 *                                    declares the expected exit code.
 */
import { spawn } from "node:child_process";
import type { VerifyExecPolicy } from "./manifest.js";

export interface VerifyExecResult {
  ok: boolean;
  /** stdout + stderr concatenated for installer log streaming. */
  output: string;
  /** Empty when ok. Failure modes: timeout, non-zero exit, spawn error. */
  error: string;
  /** The actual exit code (null if process was killed). */
  exitCode: number | null;
  /** Wall-clock duration for telemetry. */
  durationMs: number;
}

/**
 * Run the binary in a constrained subprocess and assert it returned
 * the manifest's expected exit code within the timeout.
 */
export async function runVerifyExec(
  binaryPath: string,
  policy: VerifyExecPolicy
): Promise<VerifyExecResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort();
  }, policy.timeoutMs);

  try {
    return await new Promise<VerifyExecResult>((resolve) => {
      const child = spawn(binaryPath, policy.args, {
        shell: false,
        env: { PATH: "/usr/bin:/bin" },
        stdio: ["ignore", "pipe", "pipe"],
        signal: controller.signal,
      });

      let captured = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        captured += chunk.toString("utf-8");
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        captured += chunk.toString("utf-8");
      });

      let resolved = false;
      const finish = (result: VerifyExecResult) => {
        if (resolved) return;
        resolved = true;
        resolve(result);
      };

      child.on("error", (err) => {
        const durationMs = Date.now() - startedAt;
        // The AbortController-driven timeout fires `error` first
        // (with "operation was aborted") on some Node versions, and
        // `exit` with SIGTERM on others. Either way, when the signal
        // is aborted we report it as a timeout — the user-meaningful
        // root cause — not a generic spawn failure.
        if (controller.signal.aborted) {
          finish({
            ok: false,
            output: captured,
            error: `timeout after ${policy.timeoutMs}ms`,
            exitCode: null,
            durationMs,
          });
          return;
        }
        finish({
          ok: false,
          output: captured,
          error: `spawn failed: ${err.message}`,
          exitCode: null,
          durationMs,
        });
      });

      child.on("exit", (code, signal) => {
        const durationMs = Date.now() - startedAt;
        if (controller.signal.aborted) {
          finish({
            ok: false,
            output: captured,
            error: `timeout after ${policy.timeoutMs}ms`,
            exitCode: null,
            durationMs,
          });
          return;
        }
        if (code === policy.expectExit) {
          finish({
            ok: true,
            output: captured,
            error: "",
            exitCode: code,
            durationMs,
          });
          return;
        }
        finish({
          ok: false,
          output: captured,
          error: `expected exit ${policy.expectExit}, got ${code ?? "null"}${
            signal ? ` (signal ${signal})` : ""
          }`,
          exitCode: code,
          durationMs,
        });
      });
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}
