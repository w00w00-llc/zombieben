import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  zombiebenDir,
  ensureRunnerDir,
  reposDir,
} from "@/util/paths.js";
import { log } from "@/util/logger.js";
import { ZombieBenRunner } from "@/runner/index.js";
import { createCodingAgent, resolveDefaultCodingAgent } from "@/codingagents/index.js";

const PID_FILE = path.join(zombiebenDir(), "runner.pid");

function hasRepos(): boolean {
  const dir = reposDir();
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).length > 0;
}

export function registerStartCommand(parent: Command): void {
  parent
    .command("start")
    .description("Start the ZombieBen runner daemon")
    .option("-d, --daemon", "Run in background (daemon mode)")
    .action(async (opts) => {
      ensureRunnerDir();

      if (!hasRepos()) {
        console.error(
          "No repos configured. Run `zombieben runner chat` to set up some repos.",
        );
        process.exit(1);
      }

      if (opts.daemon) {
        startDaemon();
      } else {
        await startForeground();
      }
    });
}

function startDaemon(): void {
  if (fs.existsSync(PID_FILE)) {
    const existingPid = parseInt(fs.readFileSync(PID_FILE, "utf-8"), 10);
    try {
      process.kill(existingPid, 0);
      console.error(`Runner already running (PID ${existingPid}).`);
      process.exit(1);
    } catch {
      // PID file is stale
    }
  }

  const __filename = fileURLToPath(import.meta.url);
  const child = fork(__filename, ["--foreground"], {
    detached: true,
    stdio: "ignore",
  });

  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid));
  log.info(`Runner started in background (PID ${child.pid}).`);
}

async function startForeground(): Promise<void> {
  log.tee = true;

  const selectedAgent = resolveDefaultCodingAgent();
  log.info(`Using default coding agent: ${selectedAgent}`);
  const runner = new ZombieBenRunner(createCodingAgent(selectedAgent));

  fs.writeFileSync(PID_FILE, String(process.pid));

  const shutdown = async () => {
    await runner.stop();
    if (fs.existsSync(PID_FILE)) {
      try {
        const storedPid = parseInt(fs.readFileSync(PID_FILE, "utf-8"), 10);
        if (storedPid === process.pid) {
          fs.unlinkSync(PID_FILE);
        }
      } catch {
        /* ignore */
      }
    }
  };

  process.on("SIGINT", () => {
    shutdown();
  });
  process.on("SIGTERM", () => {
    shutdown();
  });

  await runner.start();
}

if (process.argv.includes("--foreground")) {
  startForeground();
}
