import test from "node:test";
import assert from "node:assert/strict";
import { ClaudeProvider } from "../dist/adapters/llm/claude.js";

function makeFakeClient({ deltas, usage }) {
  const captured = { params: null, signal: undefined };
  return {
    captured,
    client: {
      messages: {
        stream(params, opts) {
          captured.params = params;
          captured.signal = opts?.signal;
          const handlers = new Map();
          return {
            on(event, cb) {
              handlers.set(event, cb);
              return this;
            },
            async finalMessage() {
              const cb = handlers.get("text");
              if (cb) for (const d of deltas) cb(d);
              return { usage };
            },
          };
        },
      },
    },
  };
}

test("ClaudeProvider: streams text and emits onTokenProgress", async () => {
  const deltas = ["Hello ", "world", "!"];
  const { client } = makeFakeClient({
    deltas,
    usage: { input_tokens: 42, output_tokens: 7 },
  });

  const provider = new ClaudeProvider("unused-key", "claude-sonnet-4-6", client);
  const progressCalls = [];
  const result = await provider.call("system", "user", undefined, {
    onTokenProgress: (tokens, chars) => progressCalls.push({ tokens, chars }),
  });

  assert.equal(result.content, "Hello world!");
  assert.equal(result.promptTokens, 42);
  assert.equal(result.completionTokens, 7);
  assert.equal(result.tokensUsed, 49);
  assert.equal(result.model, "claude-sonnet-4-6");

  // At least one mid-stream call plus the final snap.
  assert.ok(progressCalls.length >= 2, `expected ≥2 progress calls, got ${progressCalls.length}`);
  // Final call snaps to real output_tokens, not chunk count.
  const last = progressCalls[progressCalls.length - 1];
  assert.equal(last.tokens, 7);
  assert.equal(last.chars, "Hello world!".length);
});

test("ClaudeProvider: never sends thinking (causes streaming hang)", async () => {
  for (const model of [
    "claude-sonnet-4-6",
    "claude-opus-4-7",
    "claude-opus-4-6",
    "claude-haiku-4-5-20251001",
  ]) {
    const { client, captured } = makeFakeClient({
      deltas: ["ok"],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const provider = new ClaudeProvider("k", model, client);
    await provider.call("s", "u");
    assert.equal(
      captured.params.thinking,
      undefined,
      `${model}: thinking must not be set — adaptive thinking delayed time-to-first-token by 60s+ on long inputs`
    );
    assert.equal(captured.params.max_tokens, 50000);
    assert.equal(captured.params.model, model);
  }
});

test("ClaudeProvider: forwards temperature when provided", async () => {
  const { client, captured } = makeFakeClient({
    deltas: ["ok"],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const provider = new ClaudeProvider("k", "claude-haiku-4-5-20251001", client);
  await provider.call("s", "u", undefined, { temperature: 0.2 });
  assert.equal(captured.params.temperature, 0.2);
});

test("ClaudeProvider: modelOverride wins over constructor default", async () => {
  const { client, captured } = makeFakeClient({
    deltas: ["ok"],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const provider = new ClaudeProvider("k", "claude-sonnet-4-6", client);
  const result = await provider.call("s", "u", "claude-opus-4-7");
  assert.equal(captured.params.model, "claude-opus-4-7");
  assert.equal(captured.params.thinking, undefined);
  assert.equal(result.model, "claude-opus-4-7");
});
