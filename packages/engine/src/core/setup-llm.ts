import { pingOllama, pullOllamaModel, listOllamaModels } from "../adapters/llm/ollama.js";

export interface SetupLlmOptions {
  model: string;
  baseUrl?: string;
  /** Re-pull even if the tag already exists. */
  force?: boolean;
  onLog?: (line: string) => void;
}

const LOCAL_MODEL_ALIASES: Record<string, string> = {
  "qwen3.5": "qwen3.5:9b",
  "qwen3.5:latest": "qwen3.5:9b",
  "llama3.1:latest": "llama3.1:8b",
};

export function normalizeLocalModelId(id: string | null | undefined): string | null {
  if (!id) return null;
  const trimmed = id.trim();
  if (!trimmed) return null;
  const withoutLatest = trimmed.replace(/:latest$/, "");
  return LOCAL_MODEL_ALIASES[withoutLatest] ?? withoutLatest;
}

function localModelIdsMatch(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  const normalizedLeft = normalizeLocalModelId(left);
  const normalizedRight = normalizeLocalModelId(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft === normalizedRight;
}

/**
 * Mirrors `setup-asr.ts`: a one-shot installer the renderer can call to
 * make sure a given local model is ready to use. The Ollama daemon
 * itself is owned by the Electron main process — this helper assumes
 * it's running and only handles the model pull.
 */
export async function setupLlm(opts: SetupLlmOptions): Promise<void> {
  const baseUrl = opts.baseUrl ?? "http://127.0.0.1:11434";
  const onLog = opts.onLog;

  onLog?.(`Checking Ollama daemon at ${baseUrl}…`);
  const up = await pingOllama(baseUrl);
  if (!up) {
    throw new Error(
      `Ollama daemon not reachable at ${baseUrl}. The app should start it ` +
        `automatically — try restarting Meeting Notes.`
    );
  }
  onLog?.("✓ Ollama daemon reachable");

  if (!opts.force) {
    const installed = await listOllamaModels(baseUrl);
    if (installed.some((m) => localModelIdsMatch(m.name, opts.model))) {
      onLog?.(`✓ ${opts.model} already installed`);
      return;
    }
  }

  onLog?.(`Pulling ${opts.model}…`);
  await pullOllamaModel(opts.model, { baseUrl, onLog });

  // Verify
  const after = await listOllamaModels(baseUrl);
  if (!after.some((m) => localModelIdsMatch(m.name, opts.model))) {
    throw new Error(`Pull completed but ${opts.model} is not in the model list.`);
  }
  onLog?.(`✓ ${opts.model} ready`);
}

export async function checkOllama(
  baseUrl: string = "http://127.0.0.1:11434"
): Promise<{ daemon: boolean; installedModels: string[] }> {
  const daemon = await pingOllama(baseUrl);
  if (!daemon) return { daemon: false, installedModels: [] };
  try {
    const tags = await listOllamaModels(baseUrl);
    return { daemon: true, installedModels: tags.map((t) => t.name) };
  } catch {
    return { daemon: true, installedModels: [] };
  }
}
