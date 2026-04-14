import test from "node:test";
import assert from "node:assert/strict";
import {
  renderPromptTemplate,
  buildUserMessage,
} from "../dist/core/pipeline.js";

const baseInput = {
  title: "Sprint Retro",
  date: "2026-04-10",
  transcript: "We should ship faster.",
  manualNotes: "Focus on velocity.",
  meExcerpts: "I think we should ship faster.",
  othersExcerpts: "Agreed, let's do it.",
  prepNotes: "Review last sprint metrics.",
  attachmentContext: "Sprint report Q1.pdf content here.",
};

// ---- renderPromptTemplate ----

test("renderPromptTemplate: substitutes all known variables", () => {
  const template =
    "Title: {{title}}\nDate: {{date}}\nTranscript: {{transcript}}\n" +
    "Notes: {{notes}}\nMe: {{me_excerpts}}\nOthers: {{others_excerpts}}\n" +
    "Prep: {{prep_notes}}\nAttachments: {{attachment_context}}";
  const rendered = renderPromptTemplate(template, baseInput);
  assert.ok(rendered.includes("Title: Sprint Retro"));
  assert.ok(rendered.includes("Date: 2026-04-10"));
  assert.ok(rendered.includes("Transcript: We should ship faster."));
  assert.ok(rendered.includes("Notes: Focus on velocity."));
  assert.ok(rendered.includes("Me: I think we should ship faster."));
  assert.ok(rendered.includes("Others: Agreed, let's do it."));
  assert.ok(rendered.includes("Prep: Review last sprint metrics."));
  assert.ok(rendered.includes("Attachments: Sprint report Q1.pdf content here."));
});

test("renderPromptTemplate: preserves unknown placeholders", () => {
  const rendered = renderPromptTemplate("Hello {{unknown_var}}!", baseInput);
  assert.equal(rendered, "Hello {{unknown_var}}!");
});

test("renderPromptTemplate: handles empty optional fields", () => {
  const input = {
    ...baseInput,
    prepNotes: undefined,
    attachmentContext: undefined,
  };
  const rendered = renderPromptTemplate("Prep: {{prep_notes}} Attach: {{attachment_context}}", input);
  assert.ok(rendered.includes("Prep:  Attach: "), "optional fields should render as empty strings");
});

test("renderPromptTemplate: handles template with no placeholders", () => {
  const rendered = renderPromptTemplate("Just plain text.", baseInput);
  assert.equal(rendered, "Just plain text.");
});

// ---- buildUserMessage ----

test("buildUserMessage: includes title, date, and transcript", () => {
  const msg = buildUserMessage(baseInput);
  assert.ok(msg.includes("# Meeting: Sprint Retro"));
  assert.ok(msg.includes("**Date:** 2026-04-10"));
  assert.ok(msg.includes("## Transcript"));
  assert.ok(msg.includes("We should ship faster."));
});

test("buildUserMessage: includes manual notes when present", () => {
  const msg = buildUserMessage(baseInput);
  assert.ok(msg.includes("## Manual Notes"));
  assert.ok(msg.includes("Focus on velocity."));
});

test("buildUserMessage: includes prep notes when present", () => {
  const msg = buildUserMessage(baseInput);
  assert.ok(msg.includes("## Prep Notes"));
  assert.ok(msg.includes("Review last sprint metrics."));
});

test("buildUserMessage: includes attachment context when present", () => {
  const msg = buildUserMessage(baseInput);
  assert.ok(msg.includes("## Attached Documents"));
  assert.ok(msg.includes("Sprint report Q1.pdf content here."));
});

test("buildUserMessage: omits empty sections", () => {
  const input = {
    ...baseInput,
    manualNotes: "",
    prepNotes: "",
    attachmentContext: "",
  };
  const msg = buildUserMessage(input);
  assert.ok(!msg.includes("## Manual Notes"), "empty notes should be omitted");
  assert.ok(!msg.includes("## Prep Notes"), "empty prep should be omitted");
  assert.ok(!msg.includes("## Attached Documents"), "empty attachments should be omitted");
  assert.ok(msg.includes("## Transcript"), "transcript should still be present");
});

test("buildUserMessage: omits transcript section when empty", () => {
  const input = { ...baseInput, transcript: "" };
  const msg = buildUserMessage(input);
  assert.ok(!msg.includes("## Transcript"), "empty transcript should be omitted");
});
