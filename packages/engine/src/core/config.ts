import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export interface RecordingConfig {
  mic_device: string;
  system_device: string;
  /**
   * When true (default), the processing pipeline runs an ffmpeg sidechain-based
   * suppression pass over the mic track using the aligned system-audio track
   * as the reference signal, producing `audio/mic.clean.wav`. The cleaned mic
   * then drives ASR and the combined playback file. Disable to keep the raw
   * mic behaviour (useful while tuning the filter graph).
   */
  aec_enabled: boolean;
  /**
   * When true (default), transcript segments attributed to `me` that
   * near-textually match a concurrent `others` segment are dropped. This
   * catches residual system-audio bleed that survives AEC.
   */
  dedup_me_against_others: boolean;
}

export interface WhisperLocalConfig {
  binary_path: string;
  model_path: string;
}

export interface ParakeetMlxConfig {
  binary_path: string;
  model: string;
}

export interface ClaudeConfig {
  model: string;
}

export interface OpenAIConfig {
  model: string;
}

export interface OllamaConfig {
  base_url: string;
  model: string;
  num_ctx?: number;
}

/**
 * Obsidian is an optional viewer layer, not a mode. The on-disk layout is
 * identical regardless of whether Obsidian is involved; this object only
 * controls whether notes open in Obsidian on record and whether the detail
 * views show "Open in Obsidian" affordances.
 */
export interface ObsidianIntegrationConfig {
  enabled: boolean;
  /** basename(vault_path), used when building obsidian:// URIs */
  vault_name?: string;
  /** Absolute path Obsidian treats as the vault root */
  vault_path?: string;
}

export interface ShortcutsConfig {
  toggle_recording: string;
}

export interface AppConfig {
  /**
   * Absolute path to the Meetings directory. The layout under here is
   * identical whether or not Obsidian is used as a viewer.
   */
  data_path: string;
  obsidian_integration: ObsidianIntegrationConfig;
  asr_provider: "whisper-local" | "openai" | "parakeet-mlx";
  /**
   * Default LLM provider for prompts that don't specify their own model.
   * Per-prompt frontmatter can still override this on a call-by-call basis,
   * so a "claude" default does not preclude using local models for individual
   * prompts and vice versa.
   */
  llm_provider: "claude" | "openai" | "ollama";
  whisper_local: WhisperLocalConfig;
  parakeet_mlx: ParakeetMlxConfig;
  claude: ClaudeConfig;
  openai: OpenAIConfig;
  ollama: OllamaConfig;
  recording: RecordingConfig;
  shortcuts: ShortcutsConfig;
  chat_launcher?: {
    default_prompt: string;
    draft_prompt?: string;
    recording_prompt?: string;
  };
  /**
   * Number of days after a run ends before its audio files are automatically
   * deleted. `null` means audio is kept forever (the default).
   */
  audio_retention_days: number | null;
}

/**
 * Legacy shape — still readable on disk for back-compat. We migrate on load.
 */
interface LegacyAppConfig {
  vault_path?: string;
  base_folder?: string;
}

const DEFAULT_CONFIG: AppConfig = {
  data_path: path.join(os.homedir(), "Documents", "Gistlist"),
  obsidian_integration: {
    enabled: false,
  },
  asr_provider: "parakeet-mlx",
  llm_provider: "claude",
  whisper_local: {
    binary_path: "whisper-cli",
    model_path: "",
  },
  parakeet_mlx: {
    binary_path: path.join(os.homedir(), ".gistlist", "parakeet-venv", "bin", "mlx_audio.stt.generate"),
    model: "mlx-community/parakeet-tdt-0.6b-v2",
  },
  claude: {
    model: "claude-sonnet-4-6",
  },
  openai: {
    model: "gpt-4o",
  },
  ollama: {
    base_url: "http://127.0.0.1:11434",
    model: "qwen3.5:9b",
  },
  recording: {
    mic_device: "default",
    system_device: "", // Deprecated: system audio is now captured automatically via AudioTee
    aec_enabled: true,
    dedup_me_against_others: true,
  },
  shortcuts: {
    toggle_recording: "CommandOrControl+Shift+M",
  },
  audio_retention_days: null,
};

export function getConfigDir(): string {
  // GISTLIST_CONFIG_DIR lets alternate consumers (the MCP server, tests)
  // point the engine at a different config root without branching. The
  // Electron app never sets this, so its behavior is unchanged.
  const envDir = process.env.GISTLIST_CONFIG_DIR;
  if (envDir && envDir.trim().length > 0) return envDir;
  return path.join(os.homedir(), ".gistlist");
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), "config.yaml");
}

export function getAppLogPath(): string {
  return path.join(getConfigDir(), "app.log");
}

/**
 * Migrate legacy `vault_path` + `base_folder` configs into the new
 * `data_path` + `obsidian_integration` shape. Non-destructive: legacy
 * fields are ignored on save, so the first write-through normalizes.
 */
function migrateLegacyConfig(
  raw: Partial<AppConfig> & LegacyAppConfig
): Partial<AppConfig> {
  if (raw.data_path) return raw;
  if (raw.vault_path && raw.base_folder) {
    const vaultPath = raw.vault_path.replace(/^~/, os.homedir());
    const dataPath = path.join(vaultPath, raw.base_folder);
    const migrated: Partial<AppConfig> = {
      ...raw,
      data_path: dataPath,
      obsidian_integration: {
        enabled: true,
        vault_name: path.basename(vaultPath),
        vault_path: vaultPath,
      },
    };
    // Drop legacy keys from the object we return.
    delete (migrated as LegacyAppConfig).vault_path;
    delete (migrated as LegacyAppConfig).base_folder;
    return migrated;
  }
  return raw;
}

// ---- Config cache (mtime-based) ----
let _cachedConfig: AppConfig | null = null;
let _cachedMtimeMs = 0;

export function loadConfig(): AppConfig {
  const configPath = getConfigPath();

  // Fast path: if the file mtime hasn't changed, return cached config.
  try {
    const stat = fs.statSync(configPath);
    if (_cachedConfig && stat.mtimeMs === _cachedMtimeMs) {
      return _cachedConfig;
    }
    _cachedMtimeMs = stat.mtimeMs;
  } catch {
    throw new Error(
      `Config not found at ${configPath}. Run "gistlist init" first.`
    );
  }

  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed = (parseYaml(raw) ?? {}) as Partial<AppConfig> & LegacyAppConfig;
  const migrated = migrateLegacyConfig(parsed);
  const config: AppConfig = {
    ...DEFAULT_CONFIG,
    ...migrated,
    obsidian_integration: {
      ...DEFAULT_CONFIG.obsidian_integration,
      ...migrated.obsidian_integration,
    },
    whisper_local: { ...DEFAULT_CONFIG.whisper_local, ...migrated.whisper_local },
    parakeet_mlx: { ...DEFAULT_CONFIG.parakeet_mlx, ...migrated.parakeet_mlx },
    claude: { ...DEFAULT_CONFIG.claude, ...migrated.claude },
    ollama: { ...DEFAULT_CONFIG.ollama, ...migrated.ollama },
    recording: { ...DEFAULT_CONFIG.recording, ...migrated.recording },
    shortcuts: { ...DEFAULT_CONFIG.shortcuts, ...migrated.shortcuts },
  };
  _cachedConfig = config;
  return config;
}

/** Force the next `loadConfig()` call to re-read from disk. */
export function invalidateConfigCache(): void {
  _cachedConfig = null;
  _cachedMtimeMs = 0;
}

export function saveConfig(config: AppConfig): void {
  const configDir = getConfigDir();
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(getConfigPath(), stringifyYaml(config), "utf-8");
  invalidateConfigCache();
}

/**
 * Resolves the Meetings base path. With the new schema this is simply
 * `data_path`. Kept as a function so callers don't need to know.
 */
export function resolveBasePath(config: AppConfig): string {
  return config.data_path.replace(/^~/, os.homedir());
}

export function resolveRunsPath(config: AppConfig): string {
  return path.join(resolveBasePath(config), "Runs");
}

export { DEFAULT_CONFIG };
