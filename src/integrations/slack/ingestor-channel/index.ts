import type { IngestorChannel } from "@/ingestor/ingestor-channel.js";
import type { Ingestor } from "@/ingestor/ingestor.js";
import type { Trigger } from "@/ingestor/trigger.js";
import type { TriggerResponder } from "@/responder/responder.js";
import { SlackSocketListener } from "./listener.js";
import { SlackResponder } from "../trigger-responder/index.js";
import { createSlackWebClient } from "../web-client.js";
import { isSlackTrigger } from "./types.js";
import { getIntegrationKeys } from "@/util/keys.js";
import { log } from "@/util/logger.js";

export { type SlackTrigger, type SlackContext, type SlackPayload, isSlackTrigger } from "./types.js";

export function createSlackChannel(): IngestorChannel {
  let listener: SlackSocketListener | null = null;

  return {
    name: "slack",

    isEnabled(): boolean {
      const keys = getIntegrationKeys("slack");
      return !!keys?.app_token;
    },

    async startListener(ingestor: Ingestor): Promise<void> {
      const keys = getIntegrationKeys("slack");
      const appToken = keys?.app_token;
      if (!appToken) {
        log.info("Slack channel: missing app_token, skipping.");
        return;
      }
      listener = new SlackSocketListener(appToken, ingestor);
      await listener.start();
    },

    async stopListener(): Promise<void> {
      if (listener) {
        await listener.stop();
        listener = null;
      }
    },

    getPrimaryResponder(trigger: Trigger): TriggerResponder {
      if (!isSlackTrigger(trigger)) {
        throw new Error(`Expected slack_webhook trigger, got ${trigger.source}`);
      }
      const threadTs = trigger.raw_payload.thread_ts ?? trigger.raw_payload.ts;
      const reactTs = trigger.raw_payload.ts;
      const client = createSlackWebClient();
      return new SlackResponder(client, trigger.raw_payload.channel, threadTs, reactTs);
    },

    getChannelKey(trigger: Trigger): string {
      if (!isSlackTrigger(trigger)) {
        throw new Error(`Expected slack_webhook trigger, got ${trigger.source}`);
      }
      return `slack:${trigger.raw_payload.channel}`;
    },
  };
}
