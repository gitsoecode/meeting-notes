import fs from "node:fs";
import path from "node:path";
import { getAppLogPath } from "../core/config.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  data?: Record<string, unknown>;
}

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
  private consoleEnabled: boolean;

  constructor(component: string, opts?: { logFile?: string; console?: boolean }) {
    this.component = component;
    this.logFile = opts?.logFile ?? null;
    this.consoleEnabled = opts?.console ?? false;
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

    if (this.consoleEnabled) {
      if (level === "error") {
        console.error(line);
      } else if (level === "warn") {
        console.warn(line);
      } else {
        console.log(line);
      }
    }

    if (this.logFile) {
      const dir = path.dirname(this.logFile);
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(this.logFile, line + "\n", "utf-8");
    }
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

export function createAppLogger(consoleEnabled = false): Logger {
  return new Logger("app", { logFile: getAppLogPath(), console: consoleEnabled });
}

export function createRunLogger(runLogPath: string, consoleEnabled = false): Logger {
  return new Logger("run", { logFile: runLogPath, console: consoleEnabled });
}
