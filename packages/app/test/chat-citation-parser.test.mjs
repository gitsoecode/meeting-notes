import test from "node:test";
import assert from "node:assert/strict";

const {
  parseCitationMarkers,
  buildStoredCitations,
  stripInvalidCitations,
} = await import(
  new URL("../dist/main/chat/citation-parser.js", import.meta.url).href
);

test("parseCitationMarkers: picks out numeric and kind references", () => {
  const text = "We talked [[cite:RUN1:1500]] about [[cite:RUN2:summary]] last week.";
  const out = parseCitationMarkers(text);
  assert.equal(out.length, 2);
  assert.equal(out[0].run_id, "RUN1");
  assert.equal(out[0].ref, "1500");
  assert.equal(out[1].run_id, "RUN2");
  assert.equal(out[1].ref, "summary");
});

test("parseCitationMarkers: ignores malformed markers", () => {
  const text = "Not a [[cite:bad]] match, but [[cite:OK:42]] is.";
  const out = parseCitationMarkers(text);
  assert.equal(out.length, 1);
  assert.equal(out[0].run_id, "OK");
});

test("buildStoredCitations: resolves numeric refs to nearest transcript chunk", () => {
  const inScope = [
    {
      run_id: "RUN1",
      run_title: "Catch up with Lauren",
      run_date: "2026-02-10",
      run_status: "past",
      chunk_id: 1,
      kind: "transcript",
      speaker: "others",
      start_ms: 1000,
      end_ms: 2000,
      text: "text",
      snippet: "…",
      seekable: true,
      score: 0.9,
      participants: ["Lauren"],
    },
    {
      run_id: "RUN1",
      run_title: "Catch up with Lauren",
      run_date: "2026-02-10",
      run_status: "past",
      chunk_id: 2,
      kind: "transcript",
      speaker: "me",
      start_ms: 5000,
      end_ms: 6000,
      text: "text",
      snippet: "…",
      seekable: true,
      score: 0.8,
      participants: ["Lauren"],
    },
  ];
  const { citations, strippedInvalid } = buildStoredCitations(
    "As discussed [[cite:RUN1:5500]].",
    inScope
  );
  assert.equal(strippedInvalid, 0);
  assert.equal(citations.length, 1);
  assert.equal(citations[0].run_id, "RUN1");
  assert.equal(citations[0].start_ms, 5500);
  assert.equal(citations[0].source, "transcript");
  assert.equal(citations[0].run_title_snapshot, "Catch up with Lauren");
});

test("buildStoredCitations: kind-based refs build a non-seekable citation", () => {
  const inScope = [
    {
      run_id: "RUN2",
      run_title: "Weekly planning",
      run_date: "2026-02-12",
      run_status: "upcoming",
      chunk_id: 3,
      kind: "summary",
      speaker: null,
      start_ms: null,
      end_ms: null,
      text: "text",
      snippet: "…",
      seekable: false,
      score: 0.7,
      participants: [],
    },
  ];
  const { citations } = buildStoredCitations(
    "According to [[cite:RUN2:summary]].",
    inScope
  );
  assert.equal(citations.length, 1);
  assert.equal(citations[0].source, "summary");
  assert.equal(citations[0].start_ms, null);
});

test("buildStoredCitations: strips out-of-scope runs", () => {
  const inScope = [
    {
      run_id: "RUN_OK",
      run_title: "Foo",
      run_date: "2026-01-01",
      run_status: "past",
      chunk_id: 10,
      kind: "transcript",
      speaker: "me",
      start_ms: 0,
      end_ms: 1000,
      text: "",
      snippet: "",
      seekable: true,
      score: 1,
      participants: [],
    },
  ];
  const { citations, strippedInvalid } = buildStoredCitations(
    "ok [[cite:RUN_OK:0]] bad [[cite:OTHER:0]]",
    inScope
  );
  assert.equal(citations.length, 1);
  assert.equal(strippedInvalid, 1);
});

test("stripInvalidCitations: removes markers for runs not in scope", () => {
  const inScope = [
    {
      run_id: "RUN_OK",
      run_title: "Foo",
      run_date: "2026-01-01",
      run_status: "past",
      chunk_id: 1,
      kind: "transcript",
      speaker: null,
      start_ms: 0,
      end_ms: 0,
      text: "",
      snippet: "",
      seekable: false,
      score: 0,
      participants: [],
    },
  ];
  const out = stripInvalidCitations(
    "keep [[cite:RUN_OK:0]] drop [[cite:BAD:0]].",
    inScope
  );
  assert.ok(out.includes("[[cite:RUN_OK:0]]"));
  assert.ok(!out.includes("BAD"));
});
