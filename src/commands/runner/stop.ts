import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { zombiebenDir } from "@/util/paths.js";

const PID_FILE = path.join(zombiebenDir(), "runner.pid");

export function registerStopCommand(parent: Command): void {
  parent
    .command("stop")
    .description("Stop the ZombieBen runner daemon")
    .action(() => {
      if (!fs.existsSync(PID_FILE)) {
        console.log("No runner PID file found. Runner may not be running.");
        return;
      }

      const pid = parseInt(fs.readFileSync(PID_FILE, "utf-8"), 10);

      try {
        process.kill(pid, "SIGTERM");
        console.log(`Sent SIGTERM to runner (PID ${pid}).`);
      } catch {
        console.log(`Runner process (PID ${pid}) is not running.`);
      }

      fs.unlinkSync(PID_FILE);
    });
}
