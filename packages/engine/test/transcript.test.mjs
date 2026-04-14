import test from "node:test";
import assert from "node:assert/strict";
import {
  formatTranscriptMarkdown,
  buildSpeakerExcerpts,
  buildTranscriptForLlm,
} from "../dist/core/transcript.js";

// ---- formatTranscriptMarkdown ----

test("formatTranscriptMarkdown: formats segments with timestamps and speaker headers", () => {
  const result = {
    segments: [
      { start_ms: 0, end_ms: 5000, text: "Hello everyone.", speaker: "me" },
      { start_ms: 5000, end_ms: 12000, text: "Good morning.", speaker: "others" },
      { start_ms: 15000, end_ms: 20000, text: "Let's begin.", speaker: "me" },
    ],
    fullText: "",
    provider: "test",
    durationMs: 20000,
  };
  const md = formatTranscriptMarkdown(result);
  assert.ok(md.includes("### Me"), "should include Me header");
  assert.ok(md.includes("### Others"), "should include Others header");
  assert.ok(md.includes("`00:00`"), "should format 0ms as 00:00");
  assert.ok(md.includes("`00:05`"), "should format 5000ms as 00:05");
  assert.ok(md.includes("`00:15`"), "should format 15000ms as 00:15");
  assert.ok(md.includes("Hello everyone."));
  assert.ok(md.includes("Good morning."));
  assert.ok(md.includes("Let's begin."));
});

test("formatTranscriptMarkdown: returns fullText when no segments", () => {
  const result = {
    segments: [],
    fullText: "Raw text fallback",
    provider: "test",
    durationMs: 5000,
  };
  assert.equal(formatTranscriptMarkdown(result), "Raw text fallback");
});

test("formatTranscriptMarkdown: returns placeholder when no segments and no fullText", () => {
  const result = {
    segments: [],
    fullText: "",
    provider: "test",
    durationMs: 0,
  };
  assert.equal(formatTranscriptMarkdown(result), "(empty transcript)");
});

test("formatTranscriptMarkdown: unknown speaker does not produce a header", () => {
  const result = {
    segments: [
      { start_ms: 0, end_ms: 3000, text: "First line.", speaker: "unknown" },
      { start_ms: 3000, end_ms: 6000, text: "Second line.", speaker: "unknown" },
    ],
    fullText: "",
    provider: "test",
    durationMs: 6000,
  };
  const md = formatTranscriptMarkdown(result);
  assert.ok(!md.includes("### Unknown"), "unknown speaker should not produce a header");
  assert.ok(md.includes("First line."));
  assert.ok(md.includes("Second line."));
});

test("formatTranscriptMarkdown: handles large timestamps correctly", () => {
  const result = {
    segments: [
      { start_ms: 3723000, end_ms: 3730000, text: "Over an hour in.", speaker: "me" },
    ],
    fullText: "",
    provider: "test",
    durationMs: 3730000,
  };
  const md = formatTranscriptMarkdown(result);
  // 3723s = 62 minutes, 3 seconds
  assert.ok(md.includes("`62:03`"), "should handle timestamps over 60 minutes");
});

// ---- buildSpeakerExcerpts ----

test("buildSpeakerExcerpts: filters by speaker", () => {
  const result = {
    segments: [
      { start_ms: 0, end_ms: 3000, text: "I said this.", speaker: "me" },
      { start_ms: 3000, end_ms: 6000, text: "They said this.", speaker: "others" },
      { start_ms: 6000, end_ms: 9000, text: "I also said this.", speaker: "me" },
    ],
    fullText: "",
    provider: "test",
    durationMs: 9000,
  };
  const me = buildSpeakerExcerpts(result, "me");
  assert.ok(me.includes("I said this."));
  assert.ok(me.includes("I also said this."));
  assert.ok(!me.includes("They said this."));

  const others = buildSpeakerExcerpts(result, "others");
  assert.ok(others.includes("They said this."));
  assert.ok(!others.includes("I said this."));
});

test("buildSpeakerExcerpts: returns empty string when no segments match", () => {
  const result = {
    segments: [
      { start_ms: 0, end_ms: 3000, text: "Only me.", speaker: "me" },
    ],
    fullText: "",
    provider: "test",
    durationMs: 3000,
  };
  assert.equal(buildSpeakerExcerpts(result, "others"), "");
});

// ---- buildTranscriptForLlm ----

test("buildTranscriptForLlm: includes speaker labels inline", () => {
  const result = {
    segments: [
      { start_ms: 0, end_ms: 3000, text: "Hello.", speaker: "me" },
      { start_ms: 3000, end_ms: 6000, text: "Hi.", speaker: "others" },
      { start_ms: 6000, end_ms: 9000, text: "Unlabeled.", speaker: "unknown" },
    ],
    fullText: "",
    provider: "test",
    durationMs: 9000,
  };
  const llm = buildTranscriptForLlm(result);
  assert.ok(llm.includes("[me] Hello."), "should prefix with [me]");
  assert.ok(llm.includes("[others] Hi."), "should prefix with [others]");
  assert.ok(llm.includes("Unlabeled."), "unknown should be present");
  assert.ok(!llm.includes("[unknown]"), "unknown should not get a label prefix");
});

test("buildTranscriptForLlm: falls back to fullText when no segments", () => {
  const result = {
    segments: [],
    fullText: "Raw fallback for LLM",
    provider: "test",
    durationMs: 5000,
  };
  assert.equal(buildTranscriptForLlm(result), "Raw fallback for LLM");
});
