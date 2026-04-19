import test from "node:test";
import assert from "node:assert/strict";

const { isMetaQuery, requiresCitation, hasCitations, FAIL_CLOSED_MESSAGE } =
  await import(new URL("../dist/main/chat/guardrails.js", import.meta.url).href);

test("isMetaQuery: matches intro phrasing", () => {
  assert.equal(isMetaQuery("what can you do?"), true);
  assert.equal(isMetaQuery("how do I use you?"), true);
  assert.equal(isMetaQuery("hello"), true);
  assert.equal(isMetaQuery("hi"), true);
});

test("isMetaQuery: does not trip on meeting questions", () => {
  assert.equal(isMetaQuery("what did i talk about with lauren?"), false);
  assert.equal(isMetaQuery("when did we discuss pricing?"), false);
  assert.equal(isMetaQuery("show me upcoming meetings"), false);
});

test("requiresCitation: leaves short responses alone", () => {
  assert.equal(requiresCitation("I couldn't find anything about that."), false);
  assert.equal(requiresCitation(""), false);
});

test("requiresCitation: flags multi-sentence factual prose", () => {
  const text =
    "You discussed pricing with Lauren on Tuesday. She raised three concerns.";
  assert.equal(requiresCitation(text), true);
});

test("requiresCitation: allows clarifying questions", () => {
  const text =
    "I see a few possibilities here. Which meeting did you mean — the Monday one or the Thursday one?";
  assert.equal(requiresCitation(text), false);
});

test("hasCitations: true when at least one marker is present", () => {
  assert.equal(hasCitations("as discussed [[cite:ABC:100]]"), true);
  assert.equal(hasCitations("no citations here"), false);
});

test("FAIL_CLOSED_MESSAGE is a non-empty string", () => {
  assert.equal(typeof FAIL_CLOSED_MESSAGE, "string");
  assert.ok(FAIL_CLOSED_MESSAGE.length > 0);
});
