import test from "node:test";
import assert from "node:assert/strict";
import {
  chunkTranscript,
  chunkMarkdown,
  parseTranscriptMarkdown,
} from "../dist/core/chat-index/index.js";

test("chunkTranscript: emits one chunk per same-speaker run", () => {
  const segments = [
    { start_ms: 0, end_ms: 2000, text: "hello there", speaker: "me" },
    { start_ms: 2000, end_ms: 4000, text: "how are you", speaker: "me" },
    { start_ms: 4000, end_ms: 6000, text: "I'm great", speaker: "others" },
  ];
  const chunks = chunkTranscript(segments, { combinedAudioAvailable: true });
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].speaker, "me");
  assert.equal(chunks[0].start_ms, 0);
  assert.equal(chunks[0].end_ms, 4000);
  assert.ok(chunks[0].text.includes("hello there"));
  assert.ok(chunks[0].text.includes("how are you"));
  assert.equal(chunks[1].speaker, "others");
  assert.equal(chunks[0].seekable, true);
});

test("chunkTranscript: closes a chunk when duration exceeds 120s", () => {
  const segments = [];
  for (let i = 0; i < 10; i++) {
    segments.push({
      start_ms: i * 20_000,
      end_ms: i * 20_000 + 19_500,
      text: `line ${i}`,
      speaker: "me",
    });
  }
  const chunks = chunkTranscript(segments);
  assert.ok(chunks.length >= 2, "expected at least 2 chunks for a 200s monologue");
});

test("chunkTranscript: non-seekable when combined audio missing", () => {
  const segments = [
    { start_ms: 0, end_ms: 2000, text: "hi", speaker: "me" },
  ];
  const chunks = chunkTranscript(segments, { combinedAudioAvailable: false });
  assert.equal(chunks[0].seekable, false);
});

test("chunkMarkdown: splits by headings", () => {
  const md = `# Intro\nFirst section.\n\n# Next\nSecond section body.`;
  const chunks = chunkMarkdown(md, { kind: "summary" });
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].kind, "summary");
  assert.equal(chunks[0].seekable, false);
  assert.equal(chunks[0].start_ms, null);
});

test("chunkMarkdown: splits long sections by paragraphs", () => {
  const paragraph = "word ".repeat(400).trim();
  const md = `# Big\n${paragraph}\n\n${paragraph}\n\n${paragraph}`;
  const chunks = chunkMarkdown(md, { kind: "notes", targetTokens: 200 });
  assert.ok(chunks.length >= 2, "expected multiple chunks for long section");
});

test("parseTranscriptMarkdown: round-trips MM:SS + speaker", () => {
  const md = `### Me\n\n\`01:23\` Hello there\n\n\`01:25\` More text\n\n### Others\n\n\`01:30\` Hi back`;
  const segments = parseTranscriptMarkdown(md);
  assert.equal(segments.length, 3);
  assert.equal(segments[0].speaker, "me");
  assert.equal(segments[0].start_ms, 83_000);
  assert.equal(segments[2].speaker, "others");
  assert.equal(segments[2].start_ms, 90_000);
  assert.ok(segments[0].end_ms > segments[0].start_ms);
});

test("parseTranscriptMarkdown: handles empty input", () => {
  assert.deepEqual(parseTranscriptMarkdown(""), []);
});
