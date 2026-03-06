import { createSlackWebClient } from "../web-client.js";

export interface SlackThreadMessage {
  user: string;
  ts: string;
  text: string;
}

export async function fetchSlackThreadContext(
  channel: string,
  threadTs: string,
): Promise<SlackThreadMessage[]> {
  const client = createSlackWebClient();
  const result = await client.conversations.replies({
    channel,
    ts: threadTs,
  });

  const messages = (result.messages ?? []) as Array<{
    user?: string;
    ts?: string;
    text?: string;
  }>;

  return messages.map((m) => ({
    user: m.user ?? "",
    ts: m.ts ?? "",
    text: m.text ?? "",
  }));
}
