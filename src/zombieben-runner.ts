import { log } from "@/util/logger.js";
import { seenTriggersPath } from "@/util/paths.js";
import { processTick } from "@/runner/orchestrator.js";
import { Ingestor } from "@/ingestor/ingestor.js";
import { FileDedupStore } from "@/ingestor/dedup-store.js";
import { getAllChannels } from "@/ingestor/channels/index.js";
import { triageTrigger } from "@/triage/triage.js";
import type { IngestorChannel } from "@/ingestor/ingestor-channel.js";

const POLL_INTERVAL_MS = 5000;

export class ZombieBenRunner {
  private running = false;
  private enabledChannels: IngestorChannel[] = [];
  private ingestor: Ingestor;

  constructor() {
    const allChannels = getAllChannels();
    this.ingestor = new Ingestor({
      dedupStore: new FileDedupStore(seenTriggersPath()),
      channels: allChannels,
      onTrigger: async (result) => {
        const { trigger, responders } = result;
        const responderSummary =
          responders
            .map((r) => `${r.channelKey}[${[...r.roles]}]`)
            .join(", ") || "none";
        log.info(
          `Triaging trigger: ${trigger.source} ${trigger.id}. Responders: ${responderSummary}`,
        );
        try {
          const outcome = await triageTrigger(trigger);
          log.info(`Triage result: ${JSON.stringify(outcome, null, 2)}`);
        } catch (err) {
          log.error(`Triage error for ${trigger.id}: ${(err as Error).message}`);
        }
      },
    });
  }

  async start(): Promise<void> {
    this.running = true;
    log.info("ZombieBen runner starting...");
    log.info(`Polling every ${POLL_INTERVAL_MS / 1000}s.`);

    const allChannels = getAllChannels();
    for (const channel of allChannels) {
      if (channel.isEnabled()) {
        try {
          await channel.startListener(this.ingestor);
          this.enabledChannels.push(channel);
          log.info(`Channel started: ${channel.name}`);
        } catch (err) {
          log.error(
            `Channel ${channel.name} failed to start: ${(err as Error).message}`,
          );
        }
      } else {
        log.info(`Channel skipped (not enabled): ${channel.name}`);
      }
    }

    while (this.running) {
      try {
        await processTick();
      } catch (err) {
        log.error(`Tick error: ${(err as Error).message}`);
      }

      if (this.running) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    }
  }

  async stop(): Promise<void> {
    log.info("Shutting down...");
    this.running = false;
    for (const channel of this.enabledChannels) {
      await channel.stopListener();
    }
    this.enabledChannels = [];
  }
}
