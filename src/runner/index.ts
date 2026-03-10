import fs from "node:fs";
import path from "node:path";
import { log } from "@/util/logger.js";
import {
  seenTriggersPath,
  repoWorkflowsDir,
  runStatePath,
} from "@/util/paths.js";
import { processTick, setAgent } from "./tick.js";
import { Ingestor } from "@/ingestor/ingestor.js";
import { FileDedupStore } from "@/ingestor/dedup-store.js";
import { getAllChannels } from "@/ingestor/channels/index.js";
import { triageTrigger, killActiveTriage } from "@/triage/triage.js";
import { presentOutcome } from "@/triage/present.js";
import { applyOutcome, markRunSuperseded } from "@/triage/apply.js";
import { syncAllRepos } from "./repo-sync.js";
import { initRun } from "./init-run.js";
import type { IngestorChannel } from "@/ingestor/ingestor-channel.js";
import type { CodingAgent } from "@/codingagents/index.js";
import type { Trigger } from "@/ingestor/trigger.js";
import type { TriggerResponder } from "@/responder/responder.js";
import type { RunInitRequest } from "./init-run.js";
import type { WorkflowRunState } from "@/engine/workflow-run-state.js";
import { parseWorkflow } from "@/engine/workflow-parser.js";
import type { InProgressWorkflowAdjustment, TriageOutcome } from "@/triage/types.js";
import type { RoleTaggedResponder } from "@/responder/types.js";
import { sendRunMessage, sendRunOutcome } from "./run-notify.js";

interface RunRef {
  repoSlug: string;
  worktreeId: string;
  runId: string;
}

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

        const task = this.handleTrigger(trigger, responders, primary?.responder);
        this.activeTriage.add(task);
        task.finally(() => this.activeTriage.delete(task));
      },
    });
  }

  private async handleTrigger(
    trigger: Trigger,
    responders: readonly RoleTaggedResponder[],
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

      if (!isRetryFreshAdjustment(outcome)) {
        applyOutcome(outcome);
      }

      const result = presentOutcome(outcome);
      let startedRun: RunRef | undefined;
      let supersededRun: RunRef | undefined;
      let outcomeError: string | undefined;
      let outboundOutcome: TriageOutcome = outcome;

      if (result.retryResolution) {
        try {
          const retryContext = buildRetryContext(outcome, result.retryResolution);
          if (retryContext.workflow.confirmation_required) {
            outboundOutcome = {
              kind: "new_workflow",
              resolution: {
                type: "confirm",
                repoSlug: retryContext.repoSlug,
                workflowFile: retryContext.workflowFile,
                workflowName: retryContext.workflowName,
                inputs: retryContext.inputs,
              },
              reasoning:
                `Converted retry_fresh to confirm because workflow "${retryContext.workflowName}" has confirmation_required: true.`,
            };
            log.info(
              `Retry requires confirmation for workflow "${retryContext.workflowName}". Sent confirm outcome instead of starting run.`,
            );
          } else {
            const retryResult = await initRun(
              {
                repoSlug: retryContext.repoSlug,
                workflowFile: retryContext.workflowFile,
                workflowName: retryContext.workflowName,
                inputs: retryContext.inputs,
                worktreeId: retryContext.worktreeId,
              },
              trigger,
              responders,
              this.agent,
            );
            startedRun = {
              repoSlug: retryResult.repoSlug,
              worktreeId: retryResult.worktreeId,
              runId: retryResult.runId,
            };
            supersededRun = {
              repoSlug: result.retryResolution.repoSlug,
              worktreeId: result.retryResolution.worktreeId,
              runId: result.retryResolution.runId,
            };
            markRunSuperseded(
              supersededRun,
              startedRun,
              "Superseded by fresh retry",
            );
            log.info(
              `Retry initialized: ${startedRun.repoSlug}/${startedRun.worktreeId}/${startedRun.runId}`,
            );
          }
        } catch (err) {
          outcomeError = `Failed to start retry: ${(err as Error).message}`;
          log.error(outcomeError);
        }
      } else if (result.shouldRun && result.resolution) {
        try {
          const run = await initRun(
            {
              repoSlug: result.resolution.repoSlug,
              workflowFile: result.resolution.workflowFile,
              workflowName: result.resolution.workflowName,
              inputs: result.resolution.inputs,
              worktreeId: result.resolution.worktreeId,
            },
            trigger,
            responders,
            this.agent,
          );
          startedRun = {
            repoSlug: run.repoSlug,
            worktreeId: run.worktreeId,
            runId: run.runId,
          };
          log.info(`Run initialized for workflow "${result.resolution.workflowName}"`);
        } catch (err) {
          outcomeError = `Failed to start workflow: ${(err as Error).message}`;
          log.error(outcomeError);
        }
      }

      if (startedRun) {
        await sendRunOutcome(startedRun, outboundOutcome, responder);
        await sendRunMessage(
          startedRun,
          `Started run: \`${startedRun.repoSlug}/${startedRun.worktreeId}/runs/${startedRun.runId}\``,
          responder,
        );
        if (supersededRun) {
          await sendRunMessage(
            startedRun,
            `Superseded run: \`${supersededRun.repoSlug}/${supersededRun.worktreeId}/runs/${supersededRun.runId}\``,
            responder,
          );
        }
        if (outcomeError) {
          await sendRunMessage(startedRun, `Error: ${outcomeError}`, responder);
        }
      } else if (responder) {
        await responder.sendOutcome(outboundOutcome);
        if (outcomeError) {
          await responder.send(`Error: ${outcomeError}`);
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

function isRetryFreshAdjustment(
  outcome: Awaited<ReturnType<typeof triageTrigger>>,
): outcome is InProgressWorkflowAdjustment & { action: { type: "retry_fresh"; inputsOverride?: Record<string, string> } } {
  return outcome.kind === "in_progress_workflow_adjustment"
    && outcome.action.type === "retry_fresh";
}

function buildRetryContext(
  outcome: Awaited<ReturnType<typeof triageTrigger>>,
  retryResolution: NonNullable<ReturnType<typeof presentOutcome>["retryResolution"]>,
): RunInitRequest & { workflow: { confirmation_required?: boolean } } {
  if (!isRetryFreshAdjustment(outcome)) {
    throw new Error("Expected retry_fresh triage outcome");
  }

  const state = readRunState(
    retryResolution.repoSlug,
    retryResolution.worktreeId,
    retryResolution.runId,
  );
  const workflowPath = path.join(
    repoWorkflowsDir(retryResolution.repoSlug),
    state.workflow_file,
  );
  if (!fs.existsSync(workflowPath)) {
    throw new Error(`Workflow file not found: ${workflowPath}`);
  }
  const workflow = parseWorkflow(fs.readFileSync(workflowPath, "utf-8"));
  const inputs = toStringInputs(state.inputs);
  if (retryResolution.inputsOverride) {
    Object.assign(inputs, retryResolution.inputsOverride);
  }

  return {
    repoSlug: retryResolution.repoSlug,
    workflowFile: state.workflow_file,
    workflowName: state.workflow_name,
    inputs,
    worktreeId: retryResolution.worktreeId,
    workflow: { confirmation_required: workflow.confirmation_required },
  };
}

function readRunState(
  repoSlug: string,
  worktreeId: string,
  runId: string,
): WorkflowRunState {
  const statePath = runStatePath(repoSlug, worktreeId, runId);
  if (!fs.existsSync(statePath)) {
    throw new Error(`Run state not found: ${statePath}`);
  }
  return JSON.parse(fs.readFileSync(statePath, "utf-8")) as WorkflowRunState;
}

function toStringInputs(inputs: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(inputs)) {
    if (typeof value === "string") {
      result[key] = value;
    } else if (
      typeof value === "number"
      || typeof value === "boolean"
      || value == null
    ) {
      result[key] = String(value);
    } else {
      result[key] = JSON.stringify(value);
    }
  }
  return result;
}
