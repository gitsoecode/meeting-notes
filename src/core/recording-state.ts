import fs from "node:fs";
import path from "node:path";
import { getConfigDir } from "./config.js";

export interface ActiveRecording {
  run_id: string;
  run_folder: string;
  title: string;
  started_at: string;
  pids: number[];
  mic_path?: string;
  system_path?: string;
  system_captured: boolean;
}

function getStatePath(): string {
  return path.join(getConfigDir(), "active-recording.json");
}

export function saveActiveRecording(state: ActiveRecording): void {
  const statePath = getStatePath();
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
}

export function loadActiveRecording(): ActiveRecording | null {
  const statePath = getStatePath();
  if (!fs.existsSync(statePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf-8")) as ActiveRecording;
  } catch {
    return null;
  }
}

export function clearActiveRecording(): void {
  const statePath = getStatePath();
  if (fs.existsSync(statePath)) {
    fs.unlinkSync(statePath);
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 doesn't kill, just checks if process exists
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function stopRecordingProcesses(pids: number[]): void {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGINT");
    } catch {
      // already gone
    }
  }
}
