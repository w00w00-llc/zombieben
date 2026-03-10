import type { SlackPayload, SlackTrigger } from "./types.js";

interface SlackEvent extends SlackPayload {
  bot_id?: string;
  subtype?: string;
}

const IGNORED_SUBTYPES = new Set([
  "bot_message",
  "message_changed",
  "message_deleted",
]);

export function normalizeSlackEvent(raw: unknown): SlackEvent | null {
  if (!raw || typeof raw !== "object") return null;

  const value = raw as Record<string, unknown>;
  if (value.subtype === "message_replied") {
    const nested = value.message;
    if (!nested || typeof nested !== "object") return null;

    return toSlackEvent({
      ...nested as Record<string, unknown>,
      channel: value.channel,
    });
  }

  return toSlackEvent(value);
}

export function transformSlackEvent(raw: unknown): SlackTrigger | null {
  const event = normalizeSlackEvent(raw);
  if (!event) return null;

  if (event.bot_id || (event.subtype && IGNORED_SUBTYPES.has(event.subtype))) {
    return null;
  }

  return {
    source: "slack_webhook",
    id: `slack-${event.channel}-${event.ts}`,
    groupKeys: [`slack:${event.channel}:${event.thread_ts ?? event.ts}`],
    timestamp: new Date(parseFloat(event.ts) * 1000).toISOString(),
    raw_payload: event,
  };
}

function toSlackEvent(value: Record<string, unknown>): SlackEvent | null {
  const channel = asString(value.channel);
  const ts = asString(value.ts);
  const user = asString(value.user);
  const text = asString(value.text);
  if (!channel || !ts || !user || !text) return null;

  const threadTs = asString(value.thread_ts);
  const botId = asString(value.bot_id);
  const subtype = asString(value.subtype);

  return {
    channel,
    ts,
    user,
    text,
    ...(threadTs ? { thread_ts: threadTs } : {}),
    ...(botId ? { bot_id: botId } : {}),
    ...(subtype ? { subtype } : {}),
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
