import test from "node:test";
import assert from "node:assert/strict";

import { runVerifyExec, buildVerifyExecEnv } from "../dist/main/installers/verifyExec.js";

// runVerifyExec doesn't need Electron — it just spawns a binary and
// checks the exit code. We exercise it against system utilities that
// ship on every macOS/Linux box.

test("runVerifyExec: passes when expected exit code matches", async () => {
  const result = await runVerifyExec("/bin/echo", {
    args: ["--version"],
    expectExit: 0,
    timeoutMs: 5000,
  });
  assert.equal(result.ok, true, `expected ok, got error: ${result.error}`);
  assert.equal(result.exitCode, 0);
  assert.equal(result.error, "");
});

test("runVerifyExec: fails when exit code differs", async () => {
  // /usr/bin/false exits 1. We expect 0.
  const result = await runVerifyExec("/usr/bin/false", {
    args: [],
    expectExit: 0,
    timeoutMs: 5000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.match(result.error, /expected exit 0, got 1/);
});

test("runVerifyExec: times out hung processes", async () => {
  // /bin/sleep 5 will outlast our 200ms timeout.
  const result = await runVerifyExec("/bin/sleep", {
    args: ["5"],
    expectExit: 0,
    timeoutMs: 200,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /timeout after 200ms/);
  assert.ok(
    result.durationMs >= 200 && result.durationMs < 1500,
    `expected timeout duration near 200ms, got ${result.durationMs}`
  );
});

test("runVerifyExec: returns spawn-failed when binary does not exist", async () => {
  const result = await runVerifyExec("/no/such/binary-anywhere-on-disk", {
    args: ["--version"],
    expectExit: 0,
    timeoutMs: 5000,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /spawn failed/);
});

test("runVerifyExec: captures stdout output", async () => {
  const result = await runVerifyExec("/bin/echo", {
    args: ["hello world"],
    expectExit: 0,
    timeoutMs: 5000,
  });
  assert.equal(result.ok, true);
  assert.match(result.output, /hello world/);
});

test("buildVerifyExecEnv: forwards HOME from parent", () => {
  // Regression for issue #3: Ollama panics with "$HOME is not defined"
  // during envconfig.Models() if HOME isn't set, killing the verify-exec
  // step (see image attached to the issue). We pin PATH but must let
  // HOME through.
  const env = buildVerifyExecEnv({ HOME: "/Users/testuser", FOO: "bar" });
  assert.equal(env.HOME, "/Users/testuser");
  // PATH stays pinned — that's the whole reason we sanitize the env.
  assert.equal(env.PATH, "/usr/bin:/bin");
  // Anything else is dropped — parent FOO must not appear.
  assert.equal(env.FOO, undefined);
});

test("buildVerifyExecEnv: omits HOME when parent has no HOME", () => {
  // Defensive: runVerifyExec must not crash if the parent process
  // somehow has no HOME (e.g. running under a stripped-down launcher).
  const env = buildVerifyExecEnv({});
  assert.equal(env.HOME, undefined);
  assert.equal(env.PATH, "/usr/bin:/bin");
});
