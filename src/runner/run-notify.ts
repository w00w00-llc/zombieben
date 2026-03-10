import { runDir } from "@/util/paths.js";
import { log } from "@/util/logger.js";
import type { SendMessageOptions, TriggerResponder } from "@/responder/responder.js";
import type { TriageOutcome } from "@/triage/types.js";
import {
  instantiateRunResponders,
  loadRunRespondersSnapshot,
} from "@/responder/run-responders.js";

export interface RunRef {
  repoSlug: string;
  worktreeId: string;
  runId: string;
}

export async function sendRunOutcome(
  run: RunRef,
  outcome: TriageOutcome,
  fallback?: TriggerResponder,
  excludeChannelKeys: readonly string[] = [],
): Promise<void> {
  const responders = loadInstantiatedResponders(run, excludeChannelKeys);
  if (responders.length === 0) {
    await fallback?.sendOutcome(outcome);
    return;
  }

  for (const entry of responders) {
    try {
      await entry.responder.sendOutcome(outcome);
    } catch (err) {
      log.error(
        `Failed sending run outcome via ${entry.channelKey}: ${(err as Error).message}`,
      );
    }
  }
}

export async function sendRunMessage(
  run: RunRef,
  message: string,
  fallback?: TriggerResponder,
  options: SendMessageOptions = {},
): Promise<void> {
  const responders = loadInstantiatedResponders(run);
  if (responders.length === 0) {
    await fallback?.send(message, options);
    return;
  }

  for (const entry of responders) {
    try {
      await entry.responder.send(message, options);
    } catch (err) {
      log.error(
        `Failed sending run message via ${entry.channelKey}: ${(err as Error).message}`,
      );
    }
  }
}

function loadInstantiatedResponders(
  run: RunRef,
  excludeChannelKeys: readonly string[] = [],
) {
  const runPath = runDir(run.repoSlug, run.worktreeId, run.runId);
  const snapshot = loadRunRespondersSnapshot(runPath);
  if (!snapshot) return [];
  const excluded = new Set(excludeChannelKeys);
  return instantiateRunResponders(snapshot).filter(
    (entry) => !excluded.has(entry.channelKey),
  );
}
