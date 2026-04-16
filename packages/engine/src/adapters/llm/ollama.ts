import { Agent, fetch as undiciFetch } from "undici";
import type { LlmProvider, LlmResponse, LlmCallOptions } from "./provider.js";

/**
 * Module-scoped dispatcher for streaming chat calls. We disable undici's
 * default `headersTimeout` (300s) and `bodyTimeout` (300s) because Ollama
 * holds the connection open while loading the model and evaluating the
 * prompt before it sends the first response byte — a large prompt can
 * easily blow past 5 minutes. The real upper bound is the caller's
 * AbortSignal (plus our own 60-minute safety timeout below), not the
 * transport layer.
 */
const ollamaDispatcher = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
  keepAliveTimeout: 60_000,
});

/**
 * Pull the useful diagnostic bits out of a fetch/undici error and render
 * them as a " [name=... code=... cause=...]" suffix. undici attaches the
 * real failure reason (e.g. `UND_ERR_HEADERS_TIMEOUT`, `ECONNREFUSED`)
 * on `err.code` or nested under `err.cause`, and the plain `err.message`
 * is typically just "fetch failed".
 */
function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return "";
  const parts: string[] = [];
  if (err.name && err.name !== "Error") parts.push(`name=${err.name}`);
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && code) parts.push(`code=${code}`);
  const cause = err.cause;
  if (cause) {
    const causeParts: string[] = [];
    if (cause instanceof Error) {
      if (cause.name && cause.name !== "Error") causeParts.push(`name=${cause.name}`);
      const causeCode = (cause as { code?: unknown }).code;
      if (typeof causeCode === "string" && causeCode) causeParts.push(`code=${causeCode}`);
      if (cause.message) causeParts.push(`message=${cause.message}`);
    } else {
      causeParts.push(String(cause));
    }
    if (causeParts.length > 0) parts.push(`cause={${causeParts.join(" ")}}`);
  }
  return parts.length > 0 ? ` [${parts.join(" ")}]` : "";
}

export interface OllamaTag {
  name: string;
  size: number;
  modified_at?: string;
}

interface OllamaChatResponse {
  message?: { role: string; content: string };
  eval_count?: number;
  prompt_eval_count?: number;
  load_duration?: number;
  prompt_eval_duration?: number;
  eval_duration?: number;
  done: boolean;
}

export interface RunningOllamaModel {
  model: string;
  name?: string;
  size?: number;
  size_vram?: number;
  expires_at?: string;
  details?: {
    parameter_size?: string;
    quantization_level?: string;
    family?: string;
    families?: string[];
    format?: string;
  };
}

interface OllamaPullChunk {
  status?: string;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "qwen2.5:7b";
const DEFAULT_TEMPERATURE = 0.3;

/**
 * LlmProvider implementation backed by an Ollama HTTP daemon. The daemon
 * itself is owned by the Electron main process (see ollama-daemon.ts) —
 * this class only speaks the REST API.
 */
export class OllamaProvider implements LlmProvider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly numCtx: number | undefined;

  constructor(baseUrl: string = DEFAULT_BASE_URL, model: string = DEFAULT_MODEL, numCtx?: number) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.model = model;
    this.numCtx = numCtx;
  }

  async call(
    systemPrompt: string,
    userMessage: string,
    modelOverride?: string,
    options?: LlmCallOptions
  ): Promise<LlmResponse> {
    const model = modelOverride && modelOverride.trim() ? modelOverride : this.model;
    const url = `${this.baseUrl}/api/chat`;
    const temperature = options?.temperature ?? DEFAULT_TEMPERATURE;
    const inputChars = systemPrompt.length + userMessage.length;
    const estimatedTokens = Math.ceil(inputChars / 3.5);

    // Combine caller abort signal with a 60-minute safety timeout.
    const timeoutMs = 60 * 60_000;
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = options?.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout;

    // Only forward num_ctx when the user explicitly configured one. Modern
    // Ollama auto-sizes the context window per request; passing a fixed
    // num_ctx forces a KV-cache pre-allocation that can slow prompt
    // processing (and was a plausible contributor to past timeouts).
    const ollamaOptions: Record<string, unknown> = { temperature };
    if (this.numCtx != null) {
      ollamaOptions.num_ctx = this.numCtx;
    }

    let res: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      res = await undiciFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal,
        dispatcher: ollamaDispatcher,
        body: JSON.stringify({
          model,
          stream: true,
          keep_alive: "30s",
          options: ollamaOptions,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
        }),
      });
    } catch (err) {
      // Enrich the generic "fetch failed" with diagnostic context.
      const original = err instanceof Error ? err.message : String(err);
      const errorBreadcrumb = describeFetchError(err);
      let detail = `Ollama request to ${url} failed (model: ${model}). `;
      detail += `Input size: ~${estimatedTokens} tokens (${inputChars} chars). `;
      if (estimatedTokens > 30000) {
        detail += "The input may exceed the model's effective context window. ";
      }
      try {
        const alive = await pingOllama(this.baseUrl);
        detail += alive
          ? "Ollama is still running — the connection may have been interrupted by system sleep or a timeout."
          : "Ollama appears to be unreachable — it may have crashed or been stopped.";
      } catch {
        detail += "Could not determine if Ollama is still running.";
      }
      throw new Error(`${detail} Original error: ${original}${errorBreadcrumb}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama /api/chat ${res.status}: ${text || res.statusText}`);
    }

    // Stream NDJSON chunks to keep the TCP connection alive during inference.
    if (!res.body) {
      throw new Error("Ollama /api/chat returned no response body");
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let content = "";
    let evalCount = 0;
    let promptEvalCount = 0;
    let loadDuration = 0;
    let promptEvalDuration = 0;
    let evalDuration = 0;
    let chunkCount = 0;
    let lastProgressAt = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let chunk: OllamaChatResponse;
        try {
          chunk = JSON.parse(line) as OllamaChatResponse;
        } catch {
          continue;
        }
        if (chunk.message?.content) {
          content += chunk.message.content;
          chunkCount++;
          // Throttle progress callbacks to ~2/sec to avoid flooding IPC.
          const now = Date.now();
          if (options?.onTokenProgress && now - lastProgressAt >= 500) {
            lastProgressAt = now;
            options.onTokenProgress(chunkCount, content.length);
          }
        }
        if (chunk.done) {
          evalCount = chunk.eval_count ?? 0;
          promptEvalCount = chunk.prompt_eval_count ?? 0;
          loadDuration = chunk.load_duration ?? 0;
          promptEvalDuration = chunk.prompt_eval_duration ?? 0;
          evalDuration = chunk.eval_duration ?? 0;
        }
      }
    }

    // Final progress callback so the UI shows the total.
    if (options?.onTokenProgress && chunkCount > 0) {
      options.onTokenProgress(chunkCount, content.length);
    }

    const tokensUsed = (evalCount + promptEvalCount) || undefined;
    return {
      content,
      tokensUsed,
      promptTokens: promptEvalCount || undefined,
      completionTokens: evalCount || undefined,
      model,
      loadDurationMs: loadDuration > 0 ? Math.round(loadDuration / 1e6) : undefined,
      promptEvalTokensPerSec:
        promptEvalDuration > 0 && promptEvalCount > 0
          ? Math.round((promptEvalCount / (promptEvalDuration / 1e9)) * 10) / 10
          : undefined,
      evalTokensPerSec:
        evalDuration > 0 && evalCount > 0
          ? Math.round((evalCount / (evalDuration / 1e9)) * 10) / 10
          : undefined,
    };
  }
}

// ---- Helpers used by the main process / setup flow ----

export async function pingOllama(baseUrl: string = DEFAULT_BASE_URL): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/version`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function listOllamaModels(
  baseUrl: string = DEFAULT_BASE_URL
): Promise<OllamaTag[]> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/tags`);
  if (!res.ok) throw new Error(`Ollama /api/tags ${res.status}`);
  const data = (await res.json()) as { models?: OllamaTag[] };
  return data.models ?? [];
}

export async function listRunningOllamaModels(
  baseUrl: string = DEFAULT_BASE_URL
): Promise<RunningOllamaModel[]> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/ps`);
  if (!res.ok) throw new Error(`Ollama /api/ps ${res.status}`);
  const data = (await res.json()) as { models?: RunningOllamaModel[] };
  return data.models ?? [];
}

/**
 * Stream a model pull, forwarding human-readable status lines to onLog.
 * Resolves when the pull finishes; rejects on any chunk-level error.
 */
export interface PullProgress {
  pct: number;
  completed: number;
  total: number;
}

export async function pullOllamaModel(
  model: string,
  opts: {
    baseUrl?: string;
    onLog?: (line: string) => void;
    onProgress?: (progress: PullProgress) => void;
  } = {}
): Promise<void> {
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const onLog = opts.onLog;
  const onProgress = opts.onProgress;
  const res = await fetch(`${baseUrl}/api/pull`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, stream: true }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Ollama /api/pull ${res.status}: ${res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let lastStatus = "";
  let lastPct = -1;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let chunk: OllamaPullChunk;
      try {
        chunk = JSON.parse(line) as OllamaPullChunk;
      } catch {
        continue;
      }
      if (chunk.error) {
        throw new Error(`Ollama pull failed: ${chunk.error}`);
      }
      // Compress the firehose: only emit when status changes, plus a
      // throttled percent line per 1% increment.
      if (chunk.status && chunk.status !== lastStatus) {
        lastStatus = chunk.status;
        lastPct = -1;
        onLog?.(chunk.status);
      }
      if (
        chunk.status === "downloading" &&
        chunk.total &&
        chunk.completed != null
      ) {
        const pct = Math.floor((chunk.completed / chunk.total) * 100);
        if (pct !== lastPct) {
          lastPct = pct;
          onLog?.(`  ${pct}% (${formatBytes(chunk.completed)}/${formatBytes(chunk.total)})`);
          onProgress?.({ pct, completed: chunk.completed, total: chunk.total });
        }
      }
    }
  }
}

export async function deleteOllamaModel(
  model: string,
  baseUrl: string = DEFAULT_BASE_URL
): Promise<void> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/delete`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model }),
  });
  if (!res.ok) {
    throw new Error(`Ollama /api/delete ${res.status}: ${res.statusText}`);
  }
}

/**
 * Force-unload all models currently loaded in Ollama. Sends `keep_alive: 0`
 * to each running model so memory is freed immediately. Safe to call when
 * no models are loaded or when Ollama is unreachable.
 */
export async function unloadOllamaModels(
  baseUrl: string = DEFAULT_BASE_URL
): Promise<void> {
  let models: RunningOllamaModel[];
  try {
    models = await listRunningOllamaModels(baseUrl);
  } catch {
    return; // Ollama unreachable — nothing to unload.
  }
  const url = `${baseUrl.replace(/\/+$/, "")}/api/generate`;
  await Promise.allSettled(
    models.map((m) =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(3000),
        body: JSON.stringify({ model: m.model, keep_alive: 0 }),
      }).catch(() => {})
    )
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
