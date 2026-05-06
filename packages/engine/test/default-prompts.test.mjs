import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read from `src/` (not `dist/`) so the assertion catches mistakes the
// moment they're made in the source file. The build step copies these
// verbatim, so dist would only repeat the same content.
const PROMPTS_DIR = path.resolve(__dirname, "..", "src", "defaults", "prompts");

test("shipped summary.md uses {{user_name}} and contains no hard-coded user names", () => {
  const body = fs.readFileSync(path.join(PROMPTS_DIR, "summary.md"), "utf-8");

  assert.ok(
    body.includes("{{user_name}}"),
    "summary.md must reference {{user_name}} so the default works for every user",
  );

  // Guard against regressions where someone iterating on the prompt
  // pastes a literal name back in. "Jesse" was the original hard-coded
  // value this whole change is replacing.
  assert.ok(
    !/\bJesse\b/i.test(body),
    "summary.md must not contain a literal 'Jesse' — use {{user_name}} instead",
  );
});

test("every shipped prompt parses with valid frontmatter and a non-empty body", () => {
  for (const file of fs.readdirSync(PROMPTS_DIR)) {
    if (!file.endsWith(".md")) continue;
    const content = fs.readFileSync(path.join(PROMPTS_DIR, file), "utf-8");
    assert.ok(content.startsWith("---\n"), `${file} must start with frontmatter`);
    const closing = content.indexOf("\n---", 4);
    assert.ok(closing > 0, `${file} must close its frontmatter`);
    const body = content.slice(closing + 4).trim();
    assert.ok(body.length > 0, `${file} must have a non-empty body`);
  }
});
