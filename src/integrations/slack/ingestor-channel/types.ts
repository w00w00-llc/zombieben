import type { Trigger } from "@/ingestor/trigger.js";
import type { SlackThreadMessage } from "./context.js";

export interface SlackPayload {
  channel: string;
  ts: string;
  thread_ts?: string;
  user: string;
  text: string;
}

export interface SlackContext {
  allThreadMessages: SlackThreadMessage[];
}

export type SlackTrigger = Trigger & {
  source: "slack_webhook";
  raw_payload: SlackPayload;
  context?: SlackContext;
};

export function isSlackTrigger(trigger: Trigger): trigger is SlackTrigger {
  return trigger.source === "slack_webhook";
}
