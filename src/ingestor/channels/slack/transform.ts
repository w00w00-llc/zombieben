import type { SlackPayload } from "@/integrations/slack/types.js";
import type { SlackTrigger } from "./types.js";

interface SlackEvent extends SlackPayload {
  bot_id?: string;
  subtype?: string;
}

export function transformSlackEvent(raw: unknown): SlackTrigger | null {
  const event = raw as SlackEvent;

  if (event.bot_id || event.subtype === "bot_message") return null;

  return {
    source: "slack_webhook",
    id: `slack-${event.channel}-${event.ts}`,
    timestamp: new Date(parseFloat(event.ts) * 1000).toISOString(),
    raw_payload: event,
  };
}
