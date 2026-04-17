import test from "node:test";
import assert from "node:assert/strict";

const { parseTimestamp, formatTimestamp, findActiveEntryIndex } = await import(
  new URL("../dist/shared/timestamps.js", import.meta.url).href
);

test("parseTimestamp: mm:ss", () => {
  assert.equal(parseTimestamp("00:00"), 0);
  assert.equal(parseTimestamp("01:23"), 83);
  assert.equal(parseTimestamp("10:00"), 600);
});

test("parseTimestamp: hh:mm:ss", () => {
  assert.equal(parseTimestamp("1:02:03"), 3723);
  assert.equal(parseTimestamp("00:00:30"), 30);
});

test("parseTimestamp: whitespace tolerated", () => {
  assert.equal(parseTimestamp("  01:23  "), 83);
});

test("parseTimestamp: malformed input returns NaN", () => {
  assert.ok(Number.isNaN(parseTimestamp("")));
  assert.ok(Number.isNaN(parseTimestamp(null)));
  assert.ok(Number.isNaN(parseTimestamp(undefined)));
  assert.ok(Number.isNaN(parseTimestamp("abc")));
  assert.ok(Number.isNaN(parseTimestamp("1")));
  assert.ok(Number.isNaN(parseTimestamp("1:2:3:4")));
  assert.ok(Number.isNaN(parseTimestamp("-1:00")));
});

test("formatTimestamp: under an hour uses m:ss", () => {
  assert.equal(formatTimestamp(0), "0:00");
  assert.equal(formatTimestamp(5), "0:05");
  assert.equal(formatTimestamp(83), "1:23");
  assert.equal(formatTimestamp(600), "10:00");
});

test("formatTimestamp: over an hour uses h:mm:ss", () => {
  assert.equal(formatTimestamp(3723), "1:02:03");
});

test("formatTimestamp: negative and non-finite clamp to 0:00", () => {
  assert.equal(formatTimestamp(-5), "0:00");
  assert.equal(formatTimestamp(NaN), "0:00");
  assert.equal(formatTimestamp(Infinity), "0:00");
});

test("findActiveEntryIndex: picks latest entry <= currentTime", () => {
  const entries = [
    { timeSec: 0 },
    { timeSec: 10 },
    { timeSec: 25 },
    { timeSec: 40 },
  ];
  assert.equal(findActiveEntryIndex(entries, 0), 0);
  assert.equal(findActiveEntryIndex(entries, 9), 0);
  assert.equal(findActiveEntryIndex(entries, 10), 1);
  assert.equal(findActiveEntryIndex(entries, 24.999), 1);
  assert.equal(findActiveEntryIndex(entries, 25), 2);
  assert.equal(findActiveEntryIndex(entries, 999), 3);
});

test("findActiveEntryIndex: returns null before first entry or on invalid time", () => {
  const entries = [{ timeSec: 10 }, { timeSec: 20 }];
  assert.equal(findActiveEntryIndex(entries, 5), null);
  assert.equal(findActiveEntryIndex(entries, -1), null);
  assert.equal(findActiveEntryIndex(entries, NaN), null);
});

test("findActiveEntryIndex: skips NaN-timed entries", () => {
  const entries = [
    { timeSec: 0 },
    { timeSec: NaN },
    { timeSec: 20 },
  ];
  assert.equal(findActiveEntryIndex(entries, 10), 0);
  assert.equal(findActiveEntryIndex(entries, 25), 2);
});
