import { Command } from "commander";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { runnerLogPath } from "@/util/paths.js";

export function registerLogsCommand(parent: Command): void {
  parent
    .command("logs")
    .description("Tail the runner daemon log")
    .action(() => {
      const logFile = runnerLogPath();

      if (!fs.existsSync(logFile)) {
        console.error(`Log file not found: ${logFile}`);
        console.error("Has the runner been started yet?");
        process.exit(1);
      }

      const tail = spawn("tail", ["-f", logFile], { stdio: "inherit" });
      tail.on("exit", (code) => process.exit(code ?? 0));
    });
}
