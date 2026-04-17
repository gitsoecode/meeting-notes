import test from "node:test";
import assert from "node:assert/strict";

const { buildMatches, splitWithHighlights, buildEntryMatchSet, entryKey } =
  await import(new URL("../dist/shared/transcript-search.js", import.meta.url).href);

const entries = [
  { groupIndex: 0, entryIndex: 0, text: "Hello there, friend." },
  { groupIndex: 0, entryIndex: 1, text: "Hello again, friend of mine." },
  { groupIndex: 1, entryIndex: 0, text: "Nothing matches in this line." },
  { groupIndex: 1, entryIndex: 1, text: "friend FRIEND Friend" },
];

test("buildMatches: empty query yields no matches", () => {
  assert.deepEqual(buildMatches(entries, ""), []);
  assert.deepEqual(buildMatches(entries, "   "), []);
});

test("buildMatches: returns ordered tuples, case-insensitive", () => {
  const matches = buildMatches(entries, "friend");
  assert.equal(matches.length, 5);
  const keys = matches.map((m) => `${m.groupIndex}:${m.entryIndex}`);
  assert.deepEqual(keys, ["0:0", "0:1", "1:1", "1:1", "1:1"]);
  assert.equal(matches[0].matchIndex, 0);
  assert.equal(matches[4].matchIndex, 4);
  // First match start offset in "Hello there, friend."
  assert.equal(matches[0].start, 13);
  assert.equal(matches[0].end, 19);
});

test("buildMatches: multiple hits inside one entry", () => {
  const matches = buildMatches(entries, "friend");
  const inLast = matches.filter((m) => m.groupIndex === 1 && m.entryIndex === 1);
  assert.equal(inLast.length, 3);
  assert.deepEqual(
    inLast.map((m) => [m.start, m.end]),
    [
      [0, 6],
      [7, 13],
      [14, 20],
    ],
  );
});

test("splitWithHighlights: empty query returns single segment", () => {
  assert.deepEqual(splitWithHighlights("Hello", ""), [{ text: "Hello", highlighted: false }]);
});

test("splitWithHighlights: splits around case-insensitive matches", () => {
  const segments = splitWithHighlights("Hello there, Friend.", "friend");
  assert.deepEqual(segments, [
    { text: "Hello there, ", highlighted: false },
    { text: "Friend", highlighted: true },
    { text: ".", highlighted: false },
  ]);
});

test("splitWithHighlights: multiple matches in one string", () => {
  const segments = splitWithHighlights("ab ab ab", "ab");
  assert.deepEqual(segments, [
    { text: "ab", highlighted: true },
    { text: " ", highlighted: false },
    { text: "ab", highlighted: true },
    { text: " ", highlighted: false },
    { text: "ab", highlighted: true },
  ]);
});

test("splitWithHighlights: no match returns whole text unhighlighted", () => {
  assert.deepEqual(splitWithHighlights("nothing here", "xyz"), [
    { text: "nothing here", highlighted: false },
  ]);
});

test("buildEntryMatchSet: flags every entry with at least one match", () => {
  const matches = buildMatches(entries, "friend");
  const set = buildEntryMatchSet(matches);
  assert.ok(set.has(entryKey(0, 0)));
  assert.ok(set.has(entryKey(0, 1)));
  assert.ok(!set.has(entryKey(1, 0)));
  assert.ok(set.has(entryKey(1, 1)));
});
