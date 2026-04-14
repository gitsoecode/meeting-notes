import test from "node:test";
import assert from "node:assert/strict";
import { buildMarkdown } from "../dist/core/markdown.js";

test("buildMarkdown: produces valid frontmatter + body", () => {
  const result = buildMarkdown(
    { title: "Test", date: "2026-04-10" },
    "Hello world."
  );
  assert.ok(result.startsWith("---\n"), "should start with frontmatter delimiter");
  assert.ok(result.includes("title: Test"), "should contain title");
  assert.ok(result.includes("date: 2026-04-10"), "should contain date");
  assert.ok(result.includes("---\n\nHello world.\n"), "should have body after frontmatter");
});

test("buildMarkdown: handles empty body", () => {
  const result = buildMarkdown({ key: "value" }, "");
  assert.ok(result.includes("key: value"));
  assert.ok(result.endsWith("---\n\n\n"), "should end with empty body");
});

test("buildMarkdown: handles complex frontmatter values", () => {
  const result = buildMarkdown(
    { tags: ["a", "b"], count: 42, nested: { foo: "bar" } },
    "Content."
  );
  assert.ok(result.includes("tags:"), "should serialize array key");
  assert.ok(result.includes("count: 42"), "should serialize number");
  assert.ok(result.includes("foo: bar"), "should serialize nested object");
});
