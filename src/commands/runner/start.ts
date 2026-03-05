import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { zombiebenDir, ensureRunnerDir, reposDir, seenTriggersPath } from "@/util/paths.js";
import { processTick } from "@/runner/orchestrator.js";
import { log } from "@/util/logger.js";
import { Ingestor } from "@/ingestor/ingestor.js";
import { FileDedupStore } from "@/ingestor/dedup-store.js";
import { getAllChannels } from "@/ingestor/channels/index.js";
import type { IngestorChannel } from "@/ingestor/ingestor-channel.js";

const POLL_INTERVAL_MS = 5000;
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
    .option("-v, --verbose", "Enable verbose logging")
    .action(async (opts) => {
      ensureRunnerDir();

      if (!hasRepos()) {
        console.error("No repos configured. Run `zombieben runner chat` to set up some repos.");
        process.exit(1);
      }

      if (opts.daemon) {
        startDaemon();
      } else {
        await startForeground(opts.verbose);
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

async function startForeground(verbose = false): Promise<void> {
  log.tee = true;
  log.info("ZombieBen runner starting...");
  log.info(`Polling every ${POLL_INTERVAL_MS / 1000}s.`);

  let running = true;
  let enabledChannels: IngestorChannel[] = [];

  const dedupStore = new FileDedupStore(seenTriggersPath());
  const ingestor = new Ingestor({
    dedupStore,
    onTrigger: async (result) => {
      const { trigger, responders } = result;
      if (verbose) {
        const serializable = { trigger, responders: responders.map(r => ({ channelKey: r.channelKey, roles: [...r.roles] })) };
        log.info(JSON.stringify(serializable, null, 2));
      } else {
        const responderSummary = responders.map(r => `${r.channelKey}[${[...r.roles]}]`).join(", ") || "none";
        log.info(`Trigger ${trigger.source} ${trigger.id} → ${responderSummary}`);
      }
    },
  });

  // Start all enabled channels
  const allChannels = getAllChannels(ingestor);
  for (const channel of allChannels) {
    if (channel.isEnabled()) {
      try {
        await channel.startListener();
        enabledChannels.push(channel);
        log.info(`Channel started: ${channel.name}`);
      } catch (err) {
        log.error(`Channel ${channel.name} failed to start: ${(err as Error).message}`);
      }
    } else {
      log.info(`Channel skipped (not enabled): ${channel.name}`);
    }
  }

  const shutdown = async () => {
    log.info("Shutting down...");
    running = false;
    for (const channel of enabledChannels) {
      await channel.stopListener();
    }
    if (fs.existsSync(PID_FILE)) {
      try {
        const storedPid = parseInt(fs.readFileSync(PID_FILE, "utf-8"), 10);
        if (storedPid === process.pid) {
          fs.unlinkSync(PID_FILE);
        }
      } catch { /* ignore */ }
    }
  };

  process.on("SIGINT", () => { shutdown(); });
  process.on("SIGTERM", () => { shutdown(); });

  fs.writeFileSync(PID_FILE, String(process.pid));

  while (running) {
    try {
      await processTick();
    } catch (err) {
      log.error(`Tick error: ${(err as Error).message}`);
    }

    if (running) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}

if (process.argv.includes("--foreground")) {
  startForeground();
}
