import fs from "node:fs";
import path from "node:path";
import { getAppLogPath, getConfigDir } from "../core/config.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface StructuredLogEntry extends LogEntry {
  id: string;
  jobId?: string;
  runFolder?: string;
  processType?: string;
  pid?: number;
  stack?: string;
  detail?: string;
}

let appLoggerListener: ((entry: StructuredLogEntry) => void) | null = null;

function formatEntry(entry: LogEntry): string {
  const base = `[${entry.timestamp}] ${entry.level.toUpperCase().padEnd(5)} [${entry.component}] ${entry.message}`;
  if (entry.data && Object.keys(entry.data).length > 0) {
    return `${base} ${JSON.stringify(entry.data)}`;
  }
  return base;
}

export class Logger {
  private component: string;
  private logFile: string | null;
  private structuredFile: string | null;
  private consoleEnabled: boolean;
  private onEntry?: (entry: StructuredLogEntry) => void;

  constructor(component: string, opts?: { logFile?: string; structuredFile?: string; console?: boolean; onEntry?: (entry: StructuredLogEntry) => void }) {
    this.component = component;
    this.logFile = opts?.logFile ?? null;
    this.structuredFile = opts?.structuredFile ?? null;
    this.consoleEnabled = opts?.console ?? false;
    this.onEntry = opts?.onEntry;
  }

  private write(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      message,
      data,
    };
    const line = formatEntry(entry);
    const structuredEntry = toStructuredEntry(entry);

    if (this.consoleEnabled) {
      if (level === "error") {
        console.error(line);
      } else if (level === "warn") {
        console.warn(line);
      } else {
        console.log(line);
      }
    }

    // File writes are best-effort. Logging must never bring down the
    // process — bad GISTLIST_CONFIG_DIR (e.g., points at a non-writable
    // path), full disk, permission errors, etc. all bubble up here as
    // uncaught exceptions that crash the main process. Catch and
    // fall through to console (if enabled) so the app stays alive.
    if (this.logFile) {
      try {
        const dir = path.dirname(this.logFile);
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(this.logFile, line + "\n", "utf-8");
      } catch (err) {
        if (this.consoleEnabled) {
          console.warn(`[logger] file write failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    if (this.structuredFile) {
      try {
        const dir = path.dirname(this.structuredFile);
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(this.structuredFile, JSON.stringify(structuredEntry) + "\n", "utf-8");
      } catch {
        // Already warned above; structured-file failures share the cause.
      }
    }

    this.onEntry?.(structuredEntry);
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.write("debug", message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.write("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.write("warn", message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.write("error", message, data);
  }
}

function toStructuredEntry(entry: LogEntry): StructuredLogEntry {
  const data = entry.data;
  return {
    id: `${entry.timestamp}-${Math.random().toString(36).slice(2, 10)}`,
    ...entry,
    jobId: pickString(data, ["jobId", "job_id"]),
    runFolder: pickString(data, ["runFolder", "run_folder"]),
    processType: pickString(data, ["processType", "process_type"]),
    pid: pickNumber(data, ["pid"]),
    stack: pickString(data, ["stack"]),
    detail: pickString(data, ["detail"]),
  };
}

function pickString(data: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!data) return undefined;
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function pickNumber(data: Record<string, unknown> | undefined, keys: string[]): number | undefined {
  if (!data) return undefined;
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

export function setAppLoggerListener(listener: ((entry: StructuredLogEntry) => void) | null): void {
  appLoggerListener = listener;
}

export function createAppLogger(consoleEnabled = false): Logger {
  return new Logger("app", {
    logFile: getAppLogPath(),
    structuredFile: path.join(getConfigDir(), "app-events.jsonl"),
    console: consoleEnabled,
    onEntry: (entry) => appLoggerListener?.(entry),
  });
}

export function createRunLogger(runLogPath: string, consoleEnabled = false): Logger {
  return new Logger("run", { logFile: runLogPath, console: consoleEnabled });
}
