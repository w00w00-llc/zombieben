import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { runnerDailyLogPath, runnerLogPath, runnerLogsDir } from "@/util/paths.js";

function resolveLogToTail(): string | null {
  const todayLog = runnerDailyLogPath();
  if (fs.existsSync(todayLog)) {
    return todayLog;
  }

  const logsDir = runnerLogsDir();
  if (fs.existsSync(logsDir)) {
    const dailyLogs = fs
      .readdirSync(logsDir)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.log$/.test(name))
      .sort();
    if (dailyLogs.length > 0) {
      return path.join(logsDir, dailyLogs[dailyLogs.length - 1]);
    }
  }

  const legacyLog = runnerLogPath();
  if (fs.existsSync(legacyLog)) {
    return legacyLog;
  }
  return null;
}

export function registerLogsCommand(parent: Command): void {
  parent
    .command("logs")
    .description("Tail the runner daemon log (daily rotated)")
    .action(() => {
      const logFile = resolveLogToTail();

      if (!logFile) {
        console.error("No runner log file found.");
        console.error("Has the runner been started yet?");
        process.exit(1);
      }

      const tail = spawn("tail", ["-f", logFile], { stdio: "inherit" });
      tail.on("exit", (code) => process.exit(code ?? 0));
    });
}
