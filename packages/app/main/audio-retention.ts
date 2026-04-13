import fs from "node:fs";
import path from "node:path";
import { loadConfig, resolveRunsPath, createAppLogger } from "@meeting-notes/engine";
import { getStore } from "./store.js";
import { RUN_AUDIO_DIR, assertPathInsideRoot } from "./run-access.js";

const appLogger = createAppLogger(false);
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export async function runAudioRetentionCleanup(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch {
    return; // No config yet (first run before wizard completes)
  }

  const { audio_retention_days } = config;
  if (audio_retention_days == null || audio_retention_days <= 0) return;

  const cutoff = new Date(Date.now() - audio_retention_days * 86_400_000).toISOString();
  const runsRoot = resolveRunsPath(config);

  let expired;
  try {
    expired = getStore().listExpiredAudioRuns(cutoff);
  } catch {
    return; // DB not ready
  }

  for (const { folder_path } of expired) {
    try {
      // Validate the folder is inside the runs root
      assertPathInsideRoot(runsRoot, folder_path, "Run folder");
      const audioDir = path.join(folder_path, RUN_AUDIO_DIR);
      if (!fs.existsSync(audioDir)) continue;

      await fs.promises.rm(audioDir, { recursive: true, force: true });
      appLogger.info("Audio retention: deleted audio", { folder: folder_path });
    } catch {
      // Skip individual failures — don't block the rest
    }
  }
}

export function startAudioRetentionTimer(): () => void {
  void runAudioRetentionCleanup();
  const timer = setInterval(() => void runAudioRetentionCleanup(), SIX_HOURS_MS);
  return () => clearInterval(timer);
}
