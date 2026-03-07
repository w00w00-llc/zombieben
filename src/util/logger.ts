import fs from "node:fs";
import { runnerLogPath } from "./paths.js";

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  tee: boolean;
}

export interface CreateLoggerOpts {
  logFile?: string;
  tee?: boolean;
}

export function createLogger(opts: CreateLoggerOpts = {}): Logger {
  const filePath = opts.logFile ?? runnerLogPath();
  let tee = opts.tee ?? false;

  const colors: Record<string, string> = {
    DEBUG: "\x1b[90m",  // gray
    INFO: "\x1b[36m",   // cyan
    WARN: "\x1b[33m",   // yellow
    ERROR: "\x1b[31m",  // red
  };
  const reset = "\x1b[0m";

  function write(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    const fileLine = `[${level}] [${timestamp}] ${message}\n`;
    fs.appendFileSync(filePath, fileLine);
    if (tee) {
      const color = colors[level] ?? "";
      const ttyLine = `${color}[${level}]${reset} [${timestamp}] ${message}\n`;
      const stream = level === "ERROR" ? process.stderr : process.stdout;
      stream.write(ttyLine);
    }
  }

  return {
    debug: (message) => write("DEBUG", message),
    info: (message) => write("INFO", message),
    warn: (message) => write("WARN", message),
    error: (message) => write("ERROR", message),
    set tee(value: boolean) { tee = value; },
  };
}

export const log: Logger = createLogger();
