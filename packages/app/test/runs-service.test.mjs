import test from "node:test";
import assert from "node:assert/strict";
import { bulkReprocessRuns } from "../dist/main/runs-service.js";

test("bulkReprocessRuns keeps going after individual run failures", async () => {
  const calls = [];
  const results = await bulkReprocessRuns(
    {
      runFolders: ["/runs/one", "/runs/two", "/runs/three"],
      onlyIds: ["summary"],
    },
    async (request) => {
      calls.push(request.runFolder);
      if (request.runFolder === "/runs/two") {
        throw new Error("boom");
      }
      return {
        runFolder: request.runFolder,
        succeeded: ["summary"],
        failed: [],
      };
    }
  );

  assert.deepEqual(calls, ["/runs/one", "/runs/two", "/runs/three"]);
  assert.equal(results[0].error, undefined);
  assert.equal(results[1].error, "boom");
  assert.equal(results[2].succeeded[0], "summary");
});
