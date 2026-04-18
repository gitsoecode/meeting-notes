import test from "node:test";
import assert from "node:assert/strict";
import { OpenAIProvider } from "../dist/adapters/llm/openai.js";

function makeFakeClient({ deltas, usage }) {
  const captured = { params: null, signal: undefined };
  return {
    captured,
    client: {
      chat: {
        completions: {
          async create(params, opts) {
            captured.params = params;
            captured.signal = opts?.signal;
            async function* iter() {
              for (const d of deltas) {
                yield { choices: [{ delta: { content: d } }] };
              }
              // Final usage-only chunk (matches stream_options.include_usage).
              yield { choices: [], usage };
            }
            return iter();
          },
        },
      },
    },
  };
}

test("OpenAIProvider: streams content and emits onTokenProgress", async () => {
  const deltas = ["Hi ", "there", "."];
  const { client } = makeFakeClient({
    deltas,
    usage: { prompt_tokens: 12, completion_tokens: 4 },
  });
  const provider = new OpenAIProvider("unused", "gpt-4o", client);
  const progressCalls = [];
  const result = await provider.call("sys", "user", undefined, {
    onTokenProgress: (tokens, chars) => progressCalls.push({ tokens, chars }),
  });

  assert.equal(result.content, "Hi there.");
  assert.equal(result.promptTokens, 12);
  assert.equal(result.completionTokens, 4);
  assert.equal(result.tokensUsed, 16);
  assert.equal(result.model, "gpt-4o");

  assert.ok(progressCalls.length >= 2, `expected ≥2 progress calls, got ${progressCalls.length}`);
  const last = progressCalls[progressCalls.length - 1];
  assert.equal(last.tokens, 4);
  assert.equal(last.chars, "Hi there.".length);
});

test("OpenAIProvider: sends stream: true and include_usage", async () => {
  const { client, captured } = makeFakeClient({
    deltas: ["ok"],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  });
  const provider = new OpenAIProvider("k", "gpt-4o", client);
  await provider.call("s", "u", undefined, { temperature: 0.7 });
  assert.equal(captured.params.stream, true);
  assert.deepEqual(captured.params.stream_options, { include_usage: true });
  assert.equal(captured.params.temperature, 0.7);
  assert.equal(captured.params.messages.length, 2);
  assert.equal(captured.params.messages[0].role, "system");
  assert.equal(captured.params.messages[1].role, "user");
});

test("OpenAIProvider: modelOverride wins over constructor default", async () => {
  const { client, captured } = makeFakeClient({
    deltas: ["ok"],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  });
  const provider = new OpenAIProvider("k", "gpt-4o", client);
  const result = await provider.call("s", "u", "gpt-4o-mini");
  assert.equal(captured.params.model, "gpt-4o-mini");
  assert.equal(result.model, "gpt-4o-mini");
});

test("OpenAIProvider: handles missing usage gracefully", async () => {
  const { client } = makeFakeClient({ deltas: ["abc"], usage: undefined });
  const provider = new OpenAIProvider("k", "gpt-4o", client);
  const progressCalls = [];
  const result = await provider.call("s", "u", undefined, {
    onTokenProgress: (tokens, chars) => progressCalls.push({ tokens, chars }),
  });
  assert.equal(result.content, "abc");
  assert.equal(result.tokensUsed, undefined);
  assert.equal(result.promptTokens, undefined);
  assert.equal(result.completionTokens, undefined);
  // Final progress call falls back to chunkCount when usage is missing.
  assert.ok(progressCalls.length >= 1);
});
