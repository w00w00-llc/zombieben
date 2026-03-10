import { log } from "@/util/logger.js";
import type { TriggerResponder } from "@/responder/responder.js";

export const LOADING_EMOJI = "eyes";
export const SUCCESS_EMOJI = "white_check_mark";
export const WARNING_EMOJI = "warning";
export const ERROR_EMOJI = "x";

export async function setLoadingReaction(
  responder: TriggerResponder | undefined,
  triggerId: string,
): Promise<void> {
  await safeReact(responder, LOADING_EMOJI, triggerId);
}

export async function markCompletedReaction(
  responder: TriggerResponder | undefined,
  triggerId: string,
  opts: { outcomeError?: string } = {},
): Promise<void> {
  await safeUnreact(responder, LOADING_EMOJI, triggerId);
  await safeReact(
    responder,
    opts.outcomeError ? WARNING_EMOJI : SUCCESS_EMOJI,
    triggerId,
  );
}

export async function markFailedReaction(
  responder: TriggerResponder | undefined,
  triggerId: string,
): Promise<void> {
  await safeUnreact(responder, LOADING_EMOJI, triggerId);
  await safeReact(responder, ERROR_EMOJI, triggerId);
}

async function safeReact(
  responder: TriggerResponder | undefined,
  emoji: string,
  triggerId: string,
): Promise<void> {
  if (!responder) return;

  try {
    await responder.react(emoji);
  } catch (err) {
    log.warn(
      `Failed to add reaction :${emoji}: for ${triggerId}: ${formatError(err)}`,
    );
  }
}

async function safeUnreact(
  responder: TriggerResponder | undefined,
  emoji: string,
  triggerId: string,
): Promise<void> {
  if (!responder) return;

  try {
    await responder.unreact(emoji);
  } catch (err) {
    log.warn(
      `Failed to remove reaction :${emoji}: for ${triggerId}: ${formatError(err)}`,
    );
  }
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
