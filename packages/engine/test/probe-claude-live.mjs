// Live probe: hits the real Anthropic API and logs every onTokenProgress
// invocation. Use this to confirm streaming progress events actually fire
// against the production SDK — the unit tests only exercise the injectable
// seam and cannot catch SDK-integration bugs.
//
// Run:
//   ANTHROPIC_API_KEY=sk-... node packages/engine/test/probe-claude-live.mjs
//
// Or, to use the key stored in macOS Keychain (same one the app uses):
//   node packages/engine/test/probe-claude-live.mjs

import { ClaudeProvider } from "../dist/adapters/llm/claude.js";

async function readKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const { getSecret } = await import("../dist/core/secrets.js");
    const v = await getSecret("claude");
    if (v) return v;
  } catch (err) {
    console.warn("Keychain read failed:", err?.message ?? err);
  }
  throw new Error("No Anthropic API key. Set ANTHROPIC_API_KEY or add one via the app.");
}

const MODEL = process.argv[2] || "claude-sonnet-4-6";
const SYSTEM = "You are a helpful assistant.";
const USER =
  "Write a ~300 word summary of a typical 1:1 meeting between a manager " +
  "and direct report. Use markdown with headings and bullets.";

const apiKey = await readKey();
const provider = new ClaudeProvider(apiKey, MODEL);

const t0 = Date.now();
const progressEvents = [];

process.stdout.write(`→ probing ${MODEL} ... `);

const result = await provider.call(SYSTEM, USER, undefined, {
  onTokenProgress: (tokens, chars) => {
    const dt = Date.now() - t0;
    progressEvents.push({ dt, tokens, chars });
    process.stdout.write(`[+${dt}ms: ${tokens}t/${chars}ch] `);
  },
});

const totalMs = Date.now() - t0;
process.stdout.write("\n\n");

console.log("=== Result ===");
console.log(`model:             ${result.model}`);
console.log(`total latency:     ${totalMs}ms`);
console.log(`content chars:     ${result.content.length}`);
console.log(`prompt tokens:     ${result.promptTokens}`);
console.log(`completion tokens: ${result.completionTokens}`);
console.log(`progress events:   ${progressEvents.length}`);

if (progressEvents.length === 0) {
  console.error("\n❌ FAIL: no progress events fired. Streaming is broken.");
  process.exit(1);
}

const midStream = progressEvents.slice(0, -1);
if (midStream.length === 0) {
  console.error("\n❌ FAIL: only the final snap fired — no mid-stream deltas.");
  process.exit(1);
}

const firstMid = midStream[0];
if (firstMid.dt > 5000) {
  console.warn(
    `\n⚠️  WARN: first mid-stream event came after ${firstMid.dt}ms. ` +
      `UI will still show 0 tokens for ${firstMid.dt}ms — visible as 'frozen'.`
  );
}

console.log("\n✅ PASS: streaming emitted progress events during the call.");
console.log(
  `   first mid-stream event at +${firstMid.dt}ms, ` +
    `final snap at +${progressEvents[progressEvents.length - 1].dt}ms.`
);
