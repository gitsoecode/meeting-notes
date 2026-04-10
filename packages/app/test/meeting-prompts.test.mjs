import test from "node:test";
import assert from "node:assert/strict";

test("buildMeetingPromptCollections separates summary and merges meeting output state", async () => {
  const moduleUrl = new URL("../dist/shared/meeting-prompts.js", import.meta.url);
  const { buildMeetingPromptCollections, PRIMARY_PROMPT_ID } = await import(
    `${moduleUrl.href}?t=${Date.now()}`
  );

  const prompts = [
    {
      id: PRIMARY_PROMPT_ID,
      label: "Summary + Action Items",
      description: "Primary prompt",
      category: "Essentials",
      sort_order: 10,
      recommended: true,
      filename: "summary.md",
      enabled: true,
      auto: true,
      builtin: true,
      model: null,
      source_path: "/tmp/summary.md",
      body: "summary body",
    },
    {
      id: "decision-log",
      label: "Decision Log",
      description: "Track decisions",
      category: "Operations",
      sort_order: 20,
      recommended: false,
      filename: "decision-log.md",
      enabled: true,
      auto: false,
      builtin: true,
      model: null,
      source_path: "/tmp/decision-log.md",
      body: "decision body",
    },
    {
      id: "follow-up",
      label: "Follow-up",
      description: "Write a follow-up",
      category: "Communication",
      sort_order: 30,
      recommended: false,
      filename: "follow-up.md",
      enabled: true,
      auto: false,
      builtin: false,
      model: null,
      source_path: "/tmp/follow-up.md",
      body: "follow-up body",
    },
  ];

  const collections = buildMeetingPromptCollections({
    prompts,
    manifestSections: {
      summary: {
        filename: "summary.md",
        label: "Summary + Action Items",
        status: "complete",
      },
      "decision-log": {
        filename: "decision-log.md",
        label: "Decision Log",
        status: "running",
      },
    },
    files: [
      { name: "summary.md", kind: "document" },
      { name: "decision-log.md", kind: "document" },
      { name: "notes.md", kind: "document" },
    ],
  });

  assert.equal(collections.primaryPrompt?.id, "summary");
  assert.equal(collections.summaryFileName, "summary.md");
  assert.equal(collections.summaryStatus, "complete");
  assert.equal(collections.summaryHasOutput, true);
  assert.deepEqual(
    collections.analysisPrompts.map((prompt) => ({
      id: prompt.id,
      status: prompt.status,
      hasOutput: prompt.hasOutput,
      fileName: prompt.fileName,
    })),
    [
      {
        id: "decision-log",
        status: "running",
        hasOutput: true,
        fileName: "decision-log.md",
      },
      {
        id: "follow-up",
        status: undefined,
        hasOutput: false,
        fileName: "follow-up.md",
      },
    ]
  );
});
