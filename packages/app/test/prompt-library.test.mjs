import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const promptDefaultsDir = new URL(
  "../../engine/src/defaults/prompts/",
  import.meta.url
);

test("shipped builtin prompts remain resettable defaults without all being auto prompts", async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "meeting-notes-prompt-home-"));
  const previousHome = process.env.HOME;
  process.env.HOME = tempHome;

  try {
    const pipelineUrl = new URL("../../engine/dist/core/pipeline.js", import.meta.url);
    const pipelineModule = await import(
      `${pipelineUrl.href}?t=${Date.now()}`
    );

    const promptsDir = pipelineModule.getPromptsDir();
    pipelineModule.seedAllDefaultPrompts(promptsDir);
    const prompts = pipelineModule.loadAllPrompts();

    const summary = prompts.find((prompt) => prompt.id === "summary");
    const coaching = prompts.find((prompt) => prompt.id === "coaching");
    const oneOnOne = prompts.find((prompt) => prompt.id === "one-on-one-follow-up");

    assert.equal(summary?.builtin, true);
    assert.equal(summary?.auto, true);
    assert.equal(summary?.recommended, true);

    assert.equal(coaching?.builtin, true);
    assert.equal(coaching?.auto, false);

    assert.equal(oneOnOne?.builtin, true);
    assert.equal(oneOnOne?.auto, false);
    assert.equal(oneOnOne?.description?.length > 0, true);
    assert.equal(prompts[0]?.id, "summary");
  } finally {
    process.env.HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test("loading prompts backfills newly shipped starter prompts for existing installs", async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "meeting-notes-prompt-home-"));
  const previousHome = process.env.HOME;
  process.env.HOME = tempHome;

  try {
    const pipelineUrl = new URL("../../engine/dist/core/pipeline.js", import.meta.url);
    const pipelineModule = await import(`${pipelineUrl.href}?t=${Date.now()}`);

    const promptsDir = pipelineModule.getPromptsDir();
    fs.mkdirSync(promptsDir, { recursive: true });

    for (const fileName of ["summary.md", "coaching.md"]) {
      const src = new URL(fileName, promptDefaultsDir);
      fs.copyFileSync(src, path.join(promptsDir, fileName));
    }

    const prompts = pipelineModule.loadAllPrompts();

    assert.equal(
      prompts.some((prompt) => prompt.id === "one-on-one-follow-up"),
      true
    );
    assert.equal(
      prompts.some((prompt) => prompt.id === "customer-call-recap"),
      true
    );
    assert.equal(
      prompts.some((prompt) => prompt.id === "decision-log"),
      true
    );
    assert.equal(
      prompts.some((prompt) => prompt.id === "next-steps-email"),
      true
    );
  } finally {
    process.env.HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});
