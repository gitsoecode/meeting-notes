import test from "node:test";
import assert from "node:assert/strict";

const {
  isMetaQuery,
  requiresCitation,
  hasCitations,
  isReformatOrFollowUpQuery,
  isShortReferentialFollowUp,
  priorAssistantHadCitations,
  findPriorAssistantCitations,
  FAIL_CLOSED_MESSAGE,
} = await import(new URL("../dist/main/chat/guardrails.js", import.meta.url).href);

// Tiny factories so the history fixtures read clearly.
const userMsg = (content) => ({
  message_id: `u-${content.slice(0, 8)}`,
  thread_id: "t",
  role: "user",
  content,
  citations: [],
  created_at: "2026-04-20T00:00:00Z",
});
const assistantMsg = (content, citations = []) => ({
  message_id: `a-${content.slice(0, 8)}`,
  thread_id: "t",
  role: "assistant",
  content,
  citations,
  created_at: "2026-04-20T00:00:00Z",
});
const fakeCitation = (run_id = "RUN1") => ({
  run_id,
  source: "transcript",
  start_ms: 12000,
  end_ms: 15000,
  run_title_snapshot: "Lauren catchup",
  run_date_snapshot: "2026-04-19",
});

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

// ---------------------------------------------------------------------------
// isReformatOrFollowUpQuery

test("isReformatOrFollowUpQuery: matches explicit reformat phrasings", () => {
  assert.equal(isReformatOrFollowUpQuery("Give me that in copy-pasteable format"), true);
  assert.equal(isReformatOrFollowUpQuery("put it as a bullet list"), true);
  assert.equal(isReformatOrFollowUpQuery("show me in markdown"), true);
  assert.equal(isReformatOrFollowUpQuery("reformat that"), true);
  assert.equal(isReformatOrFollowUpQuery("rewrite the answer"), true);
  assert.equal(isReformatOrFollowUpQuery("summarize that"), true);
  assert.equal(isReformatOrFollowUpQuery("tl;dr"), true);
  assert.equal(isReformatOrFollowUpQuery("make it shorter"), true);
  assert.equal(isReformatOrFollowUpQuery("turn that into a table"), true);
});

test("isReformatOrFollowUpQuery: rejects bare broad phrasings and new questions", () => {
  // These must NOT qualify on their own — they are handled by the
  // short-referential path (which also requires a prior cited turn).
  assert.equal(isReformatOrFollowUpQuery("shorter"), false);
  assert.equal(isReformatOrFollowUpQuery("which of those"), false);
  assert.equal(isReformatOrFollowUpQuery("most important"), false);
  // Plain meeting questions.
  assert.equal(isReformatOrFollowUpQuery("what did I talk about with Lauren?"), false);
  assert.equal(isReformatOrFollowUpQuery("when did we discuss pricing?"), false);
});

// ---------------------------------------------------------------------------
// isShortReferentialFollowUp

test("isShortReferentialFollowUp: accepts short pronoun-anchored follow-ups", () => {
  assert.equal(isShortReferentialFollowUp("Which of those matters most?"), true);
  assert.equal(isShortReferentialFollowUp("Tell me more about that."), true);
  assert.equal(isShortReferentialFollowUp("Why is it like that?"), true);
  assert.equal(isShortReferentialFollowUp("Summarize them for me"), true);
});

test("isShortReferentialFollowUp: rejects long messages and pronoun-free shorts", () => {
  assert.equal(isShortReferentialFollowUp(""), false);
  assert.equal(isShortReferentialFollowUp("Tell me everything about my meeting history"), false);
  assert.equal(isShortReferentialFollowUp("What did Lauren say about pricing"), false);
  // Long enough to exceed the 80-char cap even with a pronoun.
  const longWithPronoun =
    "Please elaborate on that in extensive detail with references to every prior turn we've had";
  assert.equal(isShortReferentialFollowUp(longWithPronoun), false);
});

// ---------------------------------------------------------------------------
// priorAssistantHadCitations / findPriorAssistantCitations

test("priorAssistantHadCitations: true when most recent assistant has citations", () => {
  const history = [
    userMsg("first question"),
    assistantMsg("cited answer", [fakeCitation()]),
    userMsg("follow-up"), // current turn, appended to history
  ];
  assert.equal(priorAssistantHadCitations(history), true);
});

test("priorAssistantHadCitations: false when prior assistant had no citations", () => {
  const history = [
    userMsg("first question"),
    assistantMsg("uncited answer", []),
    userMsg("follow-up"),
  ];
  assert.equal(priorAssistantHadCitations(history), false);
});

test("priorAssistantHadCitations: false on empty or user-only history", () => {
  assert.equal(priorAssistantHadCitations([]), false);
  assert.equal(priorAssistantHadCitations([userMsg("only turn")]), false);
});

test("priorAssistantHadCitations: ignores trailing user message and walks back", () => {
  // Real-world shape: the current user turn has already been added to
  // history by the time listMessages() is called. Helper must scan back
  // to find the last assistant, not inspect the final entry.
  const history = [
    userMsg("q1"),
    assistantMsg("a1", [fakeCitation()]),
    userMsg("q2"),
    assistantMsg("a2", [fakeCitation("RUN2")]),
    userMsg("current turn"),
  ];
  assert.equal(priorAssistantHadCitations(history), true);
  const cites = findPriorAssistantCitations(history);
  assert.equal(cites.length, 1);
  assert.equal(cites[0].run_id, "RUN2");
});

test("findPriorAssistantCitations: returns empty array when no assistant history", () => {
  assert.deepEqual(findPriorAssistantCitations([]), []);
  assert.deepEqual(findPriorAssistantCitations([userMsg("q")]), []);
});

// ---------------------------------------------------------------------------
// Combined behavior (restatement vs new claim) — simulates the decision
// rule applied in retrieval-assistant.ts.

function shouldCarryForward(userMessage, history) {
  const isFollowUp =
    isReformatOrFollowUpQuery(userMessage) ||
    isShortReferentialFollowUp(userMessage);
  return isFollowUp && priorAssistantHadCitations(history);
}

test("combined rule: restatement after cited answer → carry-forward", () => {
  const history = [
    userMsg("What did I talk about with Lauren?"),
    assistantMsg("You discussed pricing [[cite:RUN1:12000]]", [fakeCitation()]),
    userMsg("Put that in a bulleted list"),
  ];
  assert.equal(shouldCarryForward("Put that in a bulleted list", history), true);
});

test("combined rule: new claim after cited answer → fail-closed", () => {
  const history = [
    userMsg("What did I talk about with Lauren?"),
    assistantMsg("You discussed pricing [[cite:RUN1:12000]]", [fakeCitation()]),
    userMsg("What did I discuss with Maria last week?"),
  ];
  // Neither reformat nor short-referential — combined rule must return
  // false so the response is fail-closed.
  assert.equal(
    shouldCarryForward("What did I discuss with Maria last week?", history),
    false,
  );
});

test("combined rule: follow-up phrasing but no prior cited → fail-closed", () => {
  const historyNoCite = [
    userMsg("q"),
    assistantMsg("plain answer", []),
    userMsg("make that shorter"),
  ];
  assert.equal(shouldCarryForward("make that shorter", historyNoCite), false);
  // First-turn case: no prior assistant at all.
  assert.equal(shouldCarryForward("make that shorter", [userMsg("q")]), false);
});

test("combined rule: short referential + prior cited → carry-forward", () => {
  const history = [
    userMsg("What did I talk about with Lauren?"),
    assistantMsg("Three topics [[cite:RUN1:12000]]", [fakeCitation()]),
    userMsg("Which of those matters most?"),
  ];
  assert.equal(
    shouldCarryForward("Which of those matters most?", history),
    true,
  );
});

test("combined rule: bare 'which of those' without prior cited → fail-closed", () => {
  const history = [
    userMsg("q"),
    assistantMsg("uncited guess", []),
    userMsg("which of those matters most?"),
  ];
  assert.equal(
    shouldCarryForward("which of those matters most?", history),
    false,
  );
});
