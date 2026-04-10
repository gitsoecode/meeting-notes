import { spawn } from "node:child_process";
import { OperationAbortedError } from "./abort.js";

export interface RunCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface RunCommandResult {
  stdout: string;
  stderr: string;
}

export function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions = {}
): Promise<RunCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeoutId: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      options.signal?.removeEventListener("abort", onAbort);
    };

    const finish = (err: Error | null, result?: RunCommandResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else resolve(result ?? { stdout, stderr });
    };

    const onAbort = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        // best effort
      }
      finish(new OperationAbortedError());
    };

    if (options.signal?.aborted) {
      onAbort();
      return;
    }

    options.signal?.addEventListener("abort", onAbort, { once: true });

    if (options.timeoutMs != null) {
      timeoutId = setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch {
          // best effort
        }
        const error = new Error(
          `Command timed out after ${options.timeoutMs}ms: ${command} ${args.join(" ")}`
        );
        finish(error);
      }, options.timeoutMs);
    }

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      finish(error);
    });
    child.on("close", (code, signal) => {
      if (options.signal?.aborted) {
        finish(new OperationAbortedError());
        return;
      }
      if (code === 0) {
        finish(null, { stdout, stderr });
        return;
      }
      finish(
        new Error(
          `Command failed (${code ?? "null"}${signal ? `, ${signal}` : ""}): ${command} ${args.join(" ")}`
        )
      );
    });
  });
}
