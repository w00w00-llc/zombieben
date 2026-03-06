import type { WebClient } from "@slack/web-api";
import type { TriggerResponder } from "@/responder/responder.js";
import { createSlackWebClient } from "../web-client.js";
import { getIntegrationKeys } from "@/util/keys.js";

export class SlackNotifierResponder implements TriggerResponder {
  constructor(
    private client: WebClient,
    private channel: string,
  ) {}

  async send(message: string): Promise<void> {
    await this.client.chat.postMessage({
      channel: this.channel,
      text: message,
    });
  }

  async promptChoice(_message: string, _options: string[]): Promise<never> {
    throw new Error("promptChoice is not supported on notifier responders");
  }

  async waitForReply(_prompt: string): Promise<never> {
    throw new Error("waitForReply is not supported on notifier responders");
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
