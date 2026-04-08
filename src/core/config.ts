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

export interface AppConfig {
  vault_path: string;
  base_folder: string;
  asr_provider: "whisper-local" | "openai" | "parakeet-mlx";
  llm_provider: "claude";
  whisper_local: WhisperLocalConfig;
  parakeet_mlx: ParakeetMlxConfig;
  claude: ClaudeConfig;
  recording: RecordingConfig;
}

const DEFAULT_CONFIG: AppConfig = {
  vault_path: path.join(os.homedir(), "Obsidian", "My-Vault"),
  base_folder: "Meetings",
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
  recording: {
    mic_device: "default",
    system_device: "BlackHole 2ch",
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

export function loadConfig(): AppConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Config not found at ${configPath}. Run "meeting-notes init" first.`
    );
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed = parseYaml(raw) as Partial<AppConfig>;
  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    whisper_local: { ...DEFAULT_CONFIG.whisper_local, ...parsed.whisper_local },
    parakeet_mlx: { ...DEFAULT_CONFIG.parakeet_mlx, ...parsed.parakeet_mlx },
    claude: { ...DEFAULT_CONFIG.claude, ...parsed.claude },
    recording: { ...DEFAULT_CONFIG.recording, ...parsed.recording },
  };
}

export function saveConfig(config: AppConfig): void {
  const configDir = getConfigDir();
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(getConfigPath(), stringifyYaml(config), "utf-8");
}

export function resolveBasePath(config: AppConfig): string {
  const vaultPath = config.vault_path.replace(/^~/, os.homedir());
  return path.join(vaultPath, config.base_folder);
}

export function resolveRunsPath(config: AppConfig): string {
  return path.join(resolveBasePath(config), "Runs");
}

export { DEFAULT_CONFIG };
