import { log } from "@/util/logger.js";
import { seenTriggersPath } from "@/util/paths.js";
import { processTick, setAgent } from "./tick.js";
import { Ingestor } from "@/ingestor/ingestor.js";
import { FileDedupStore } from "@/ingestor/dedup-store.js";
import { getAllChannels } from "@/ingestor/channels/index.js";
import { triageTrigger, killActiveTriage } from "@/triage/triage.js";
import { presentOutcome } from "@/triage/present.js";
import { applyOutcome } from "@/triage/apply.js";
import { syncAllRepos } from "./repo-sync.js";
import { initRun } from "./init-run.js";
import type { IngestorChannel } from "@/ingestor/ingestor-channel.js";
import type { CodingAgent } from "@/codingagents/index.js";
import type { Trigger } from "@/ingestor/trigger.js";
import type { TriggerResponder } from "@/responder/responder.js";

const POLL_INTERVAL_MS = 5000;

export class ZombieBenRunner {
  private running = false;
  private enabledChannels: IngestorChannel[] = [];
  private ingestor: Ingestor;
  private agent: CodingAgent;
  private activeTriage = new Set<Promise<void>>();

  constructor(agent: CodingAgent) {
    this.agent = agent;
    setAgent(agent);

    const allChannels = getAllChannels();
    this.ingestor = new Ingestor({
      dedupStore: new FileDedupStore(seenTriggersPath()),
      channels: allChannels,
      onTrigger: (result) => {
        const { trigger, responders } = result;
        const primary = responders.find((r) => r.roles.has("primary"));
        log.info(`Triaging trigger: ${trigger.id}`);

        const task = this.handleTrigger(trigger, primary?.responder);
        this.activeTriage.add(task);
        task.finally(() => this.activeTriage.delete(task));
      },
    });
  }

  private async handleTrigger(
    trigger: Trigger,
    responder?: TriggerResponder,
  ): Promise<void> {
    const LOADING_EMOJI = "eyes";
    await responder?.react(LOADING_EMOJI);

    try {
      await syncAllRepos();
      const outcome = await triageTrigger(trigger, { agent: this.agent });
      log.info(
        `Triage result (${trigger.id}): ${JSON.stringify(outcome, null, 2)}`,
      );
      await responder?.unreact(LOADING_EMOJI);

      applyOutcome(outcome);

      if (responder) {
        const result = await presentOutcome(outcome, responder);

        if (result.shouldRun && result.resolution) {
          try {
            await initRun(
              {
                repoSlug: result.resolution.repoSlug,
                workflowFile: result.resolution.workflowFile,
                workflowName: result.resolution.workflowName,
                inputs: result.resolution.inputs,
                worktreeId: result.resolution.worktreeId,
              },
              trigger,
            );
            log.info(`Run initialized for workflow "${result.resolution.workflowName}"`);
          } catch (err) {
            log.error(`Failed to init run: ${(err as Error).message}`);
            await responder.send(
              `Failed to start workflow: ${(err as Error).message}`,
            );
          }
        }
      }
    } catch (err) {
      log.error(
        `Triage error for ${trigger.id}: ${(err as Error).message}`,
      );
      await responder?.unreact(LOADING_EMOJI);
      await responder?.send(
        "Something went wrong during triage.",
      );
    }
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
          log.info(`Ingestion channel started: ${channel.name}`);
        } catch (err) {
          log.error(
            `Ingestion channel ${channel.name} failed to start: ${(err as Error).message}`,
          );
        }
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
    killActiveTriage();
    await Promise.allSettled(this.activeTriage);
    for (const channel of this.enabledChannels) {
      await channel.stopListener();
    }
    this.enabledChannels = [];
  }
}
