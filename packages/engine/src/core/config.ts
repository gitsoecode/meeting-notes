import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export interface RecordingConfig {
  mic_device: string;
  system_device: string;
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

export interface OllamaConfig {
  base_url: string;
  model: string;
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
  llm_provider: "claude" | "ollama";
  whisper_local: WhisperLocalConfig;
  parakeet_mlx: ParakeetMlxConfig;
  claude: ClaudeConfig;
  ollama: OllamaConfig;
  recording: RecordingConfig;
  shortcuts: ShortcutsConfig;
}

/**
 * Legacy shape — still readable on disk for back-compat. We migrate on load.
 */
interface LegacyAppConfig {
  vault_path?: string;
  base_folder?: string;
}

const DEFAULT_CONFIG: AppConfig = {
  data_path: path.join(os.homedir(), "Documents", "Meeting Notes"),
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
    binary_path: path.join(os.homedir(), ".meeting-notes", "parakeet-venv", "bin", "mlx_audio.stt.generate"),
    model: "mlx-community/parakeet-tdt-0.6b-v2",
  },
  claude: {
    model: "claude-sonnet-4-6",
  },
  ollama: {
    base_url: "http://127.0.0.1:11434",
    model: "qwen3.5:9b",
  },
  recording: {
    mic_device: "default",
    system_device: "BlackHole 2ch",
  },
  shortcuts: {
    toggle_recording: "CommandOrControl+Shift+M",
  },
};

export function getConfigDir(): string {
  return path.join(os.homedir(), ".meeting-notes");
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

export function loadConfig(): AppConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Config not found at ${configPath}. Run "meeting-notes init" first.`
    );
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed = (parseYaml(raw) ?? {}) as Partial<AppConfig> & LegacyAppConfig;
  const migrated = migrateLegacyConfig(parsed);
  return {
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
}

export function saveConfig(config: AppConfig): void {
  const configDir = getConfigDir();
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(getConfigPath(), stringifyYaml(config), "utf-8");
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
