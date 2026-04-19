import { Agent, fetch as undiciFetch } from "undici";

const embedDispatcher = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
  keepAliveTimeout: 60_000,
});

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
export const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text";
const BATCH_SIZE = 32;

export interface EmbedOptions {
  baseUrl?: string;
  model?: string;
  signal?: AbortSignal;
}

/**
 * Embed a batch of texts via Ollama's /api/embed endpoint. Returns one
 * number[] per input. Batches of up to 32 inputs per HTTP call; callers
 * may pass arbitrary-length arrays.
 */
export async function embedViaOllama(
  inputs: string[],
  opts: EmbedOptions = {}
): Promise<number[][]> {
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = opts.model ?? DEFAULT_EMBEDDING_MODEL;
  if (inputs.length === 0) return [];

  const out: number[][] = [];
  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    const batch = inputs.slice(i, i + BATCH_SIZE);
    const res = await undiciFetch(`${baseUrl}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: opts.signal,
      dispatcher: embedDispatcher,
      body: JSON.stringify({
        model,
        input: batch,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama /api/embed ${res.status}: ${text || res.statusText}`);
    }
    const data = (await res.json()) as { embeddings?: number[][] };
    if (!data.embeddings || data.embeddings.length !== batch.length) {
      throw new Error(
        `Ollama /api/embed returned ${data.embeddings?.length ?? 0} embeddings for ${batch.length} inputs`
      );
    }
    out.push(...data.embeddings);
  }
  return out;
}

/**
 * Factory used by the app to build a model-bound embedder without leaking
 * the Ollama base URL into every call site.
 */
export function createOllamaEmbedder(opts: {
  baseUrl: string;
  model: string;
}): (inputs: string[], signal?: AbortSignal) => Promise<number[][]> {
  return (inputs: string[], signal?: AbortSignal) =>
    embedViaOllama(inputs, { baseUrl: opts.baseUrl, model: opts.model, signal });
}
