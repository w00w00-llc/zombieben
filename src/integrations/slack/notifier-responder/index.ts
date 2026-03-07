import type { WebClient } from "@slack/web-api";
import type {
  TriggerResponder,
  SentMessage,
} from "@/responder/responder.js";
import type { TriageOutcome } from "@/triage/types.js";
import { createSlackWebClient } from "../web-client.js";
import { getIntegrationKeys } from "@/util/keys.js";
import { formatSlackOutcomeText } from "../outcome-format.js";

export class SlackNotifierResponder implements TriggerResponder {
  constructor(
    private client: WebClient,
    private channel: string,
  ) {}

  async send(message: string): Promise<SentMessage> {
    const result = await this.client.chat.postMessage({
      channel: this.channel,
      text: message,
    });
    return { id: result.ts as string };
  }

  async sendOutcome(outcome: TriageOutcome): Promise<SentMessage> {
    const text = formatSlackOutcomeText(outcome);
    const result = await this.client.chat.postMessage({
      channel: this.channel,
      text,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text,
          },
        },
      ],
    });
    return { id: result.ts as string };
  }

  async edit(sent: SentMessage, message: string): Promise<void> {
    await this.client.chat.update({
      channel: this.channel,
      ts: sent.id,
      text: message,
    });
  }

  async react(_emoji: string): Promise<void> {
    // No-op: notifier posts to a different channel, no message to react to
  }

  async unreact(_emoji: string): Promise<void> {
    // No-op
  }

}

export function createSlackNotifierResponder(): {
  channelKey: string;
  responder: TriggerResponder;
} | null {
  const keys = getIntegrationKeys("slack");
  const channel = keys?.notification_channel;
  if (!channel) return null;

  const client = createSlackWebClient();
  return {
    channelKey: `slack:${channel}`,
    responder: new SlackNotifierResponder(client, channel),
  };
}
