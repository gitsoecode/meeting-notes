import fs from "node:fs";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { getConfigDir, type StructuredLogEntry } from "@gistlist/engine";
import type { ActivityProcess, AppLogEntry, AppLogQuery } from "../shared/ipc.js";
import { broadcastToAll } from "./events.js";

const PROCESS_EVENT_CHANNEL = "logs:process-update";
const LOG_EVENT_CHANNEL = "logs:entry";
const APP_EVENTS_FILE = path.join(getConfigDir(), "app-events.jsonl");
const processes = new Map<string, ActivityProcess>();

export function handleStructuredAppLog(entry: StructuredLogEntry): void {
  broadcastToAll(LOG_EVENT_CHANNEL, entry satisfies AppLogEntry);
}

export function listAppEntries(query: AppLogQuery = {}): AppLogEntry[] {
  const entries = readAppEntriesFromDisk().sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  if (query.limit && query.limit > 0) {
    return entries.slice(0, query.limit);
  }
  return entries;
}

export function listProcesses(): ActivityProcess[] {
  return [...processes.values()].sort(compareProcesses);
}

export function startTrackedProcess(input: {
  id?: string;
  type: string;
  label: string;
  pid?: number;
  command?: string;
  jobId?: string;
  runFolder?: string;
  status?: ActivityProcess["status"];
}): string {
  const id = input.id ?? `${input.type}:${input.pid ?? Math.random().toString(36).slice(2, 10)}`;
  const next: ActivityProcess = {
    id,
    type: input.type,
    label: input.label,
    pid: input.pid,
    command: input.command,
    jobId: input.jobId,
    runFolder: input.runFolder,
    status: input.status ?? "starting",
    startedAt: new Date().toISOString(),
  };
  processes.set(id, next);
  broadcastToAll(PROCESS_EVENT_CHANNEL, next);
  return id;
}

export function updateTrackedProcess(id: string, patch: Partial<ActivityProcess>): void {
  const current = processes.get(id);
  if (!current) return;
  const next = { ...current, ...patch };
  processes.set(id, next);
  broadcastToAll(PROCESS_EVENT_CHANNEL, next);
}

export function finishTrackedProcess(
  id: string,
  patch: Partial<ActivityProcess> & Pick<ActivityProcess, "status">
): void {
  const current = processes.get(id);
  if (!current) return;
  const next: ActivityProcess = {
    ...current,
    ...patch,
    endedAt: patch.endedAt ?? new Date().toISOString(),
  };
  processes.set(id, next);
  broadcastToAll(PROCESS_EVENT_CHANNEL, next);
}

export function trackChildProcess(
  child: ChildProcess,
  input: {
    id?: string;
    type: string;
    label: string;
    command?: string;
    jobId?: string;
    runFolder?: string;
  }
): string {
  const id = startTrackedProcess({
    ...input,
    pid: child.pid,
    status: child.pid ? "running" : "starting",
  });

  child.on("spawn", () => {
    updateTrackedProcess(id, {
      pid: child.pid,
      status: "running",
    });
  });
  child.on("error", (error) => {
    finishTrackedProcess(id, {
      status: "failed",
      error: error.message,
    });
  });
  child.on("exit", (code, signal) => {
    finishTrackedProcess(id, {
      status: code === 0 ? "exited" : "failed",
      exitCode: code,
      signal,
      error: code === 0 ? undefined : `Exited with code ${code ?? "unknown"}`,
    });
  });

  return id;
}

function readAppEntriesFromDisk(): AppLogEntry[] {
  if (!fs.existsSync(APP_EVENTS_FILE)) return [];
  const content = fs.readFileSync(APP_EVENTS_FILE, "utf-8");
  const entries: AppLogEntry[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as AppLogEntry;
      if (parsed && typeof parsed.timestamp === "string") {
        entries.push(parsed);
      }
    } catch {
      // Ignore malformed lines so a partial write never breaks the UI.
    }
  }
  return entries;
}

function compareProcesses(left: ActivityProcess, right: ActivityProcess): number {
  const leftRunning = left.status === "running" || left.status === "starting" ? 0 : 1;
  const rightRunning = right.status === "running" || right.status === "starting" ? 0 : 1;
  if (leftRunning !== rightRunning) return leftRunning - rightRunning;
  return right.startedAt.localeCompare(left.startedAt);
}
