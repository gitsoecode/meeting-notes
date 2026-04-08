import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { AppConfig, resolveBasePath, saveConfig } from "./config.js";

export interface MoveDataDirectoryResult {
  from: string;
  to: string;
  moved: boolean;
}

/**
 * Move the data directory (the one that contains `Runs/`, `Dashboard.md`,
 * `Templates/`) from its current location to `newPath`, and update config.
 *
 * - If source and destination are on the same filesystem, `fs.rename` is
 *   used (atomic, cheap).
 * - Otherwise we copy the tree and delete the source.
 * - If the source doesn't exist yet, we just update config and (optionally)
 *   create the destination.
 * - If the destination already exists and isn't empty, we bail with an
 *   error — overwrite would be destructive.
 */
export function moveDataDirectory(
  config: AppConfig,
  newPath: string
): { updatedConfig: AppConfig; result: MoveDataDirectoryResult } {
  const from = resolveBasePath(config);
  const to = path.resolve(newPath.replace(/^~/, os.homedir()));

  if (from === to) {
    return {
      updatedConfig: config,
      result: { from, to, moved: false },
    };
  }

  const destExists = fs.existsSync(to);
  if (destExists) {
    const entries = fs.readdirSync(to);
    if (entries.length > 0) {
      throw new Error(
        `Destination "${to}" already exists and is not empty. ` +
          `Pick an empty folder or a non-existent path.`
      );
    }
  }

  let moved = false;
  if (fs.existsSync(from)) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try {
      fs.renameSync(from, to);
      moved = true;
    } catch (err) {
      // Cross-device rename — copy + delete.
      if ((err as NodeJS.ErrnoException).code === "EXDEV") {
        fs.cpSync(from, to, { recursive: true });
        fs.rmSync(from, { recursive: true, force: true });
        moved = true;
      } else {
        throw err;
      }
    }
  } else {
    fs.mkdirSync(to, { recursive: true });
  }

  const updatedConfig: AppConfig = { ...config, data_path: to };
  saveConfig(updatedConfig);

  return {
    updatedConfig,
    result: { from, to, moved },
  };
}
