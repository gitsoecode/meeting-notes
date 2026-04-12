import type { LlmProvider, LlmResponse, LlmCallOptions } from "./provider.js";

export interface OllamaTag {
  name: string;
  size: number;
  modified_at?: string;
}

interface OllamaChatResponse {
  message?: { role: string; content: string };
  eval_count?: number;
  prompt_eval_count?: number;
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

/**
 * LlmProvider implementation backed by an Ollama HTTP daemon. The daemon
 * itself is owned by the Electron main process (see ollama-daemon.ts) —
 * this class only speaks the REST API.
 */
export class OllamaProvider implements LlmProvider {
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(baseUrl: string = DEFAULT_BASE_URL, model: string = DEFAULT_MODEL) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.model = model;
  }

  async call(
    systemPrompt: string,
    userMessage: string,
    modelOverride?: string,
    options?: LlmCallOptions
  ): Promise<LlmResponse> {
    const model = modelOverride && modelOverride.trim() ? modelOverride : this.model;
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: options?.signal,
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: "5s",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama /api/chat ${res.status}: ${text || res.statusText}`);
    }
    const data = (await res.json()) as OllamaChatResponse;
    const content = data.message?.content ?? "";
    const tokensUsed =
      (data.eval_count ?? 0) + (data.prompt_eval_count ?? 0) || undefined;
    return { content, tokensUsed, model };
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
