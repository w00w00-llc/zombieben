import type { IngestorChannel } from "@/ingestor/ingestor-channel.js";
import type { Ingestor } from "@/ingestor/ingestor.js";
import { SlackSocketListener } from "./listener.js";
import { getIntegrationKeys } from "@/util/keys.js";
import { log } from "@/util/logger.js";

export { type SlackTrigger, type SlackContext, isSlackTrigger } from "./types.js";

export function createSlackChannel(ingestor: Ingestor): IngestorChannel {
  let listener: SlackSocketListener | null = null;

  return {
    name: "slack",

    isEnabled(): boolean {
      const keys = getIntegrationKeys("slack");
      return !!keys?.app_token;
    },

    async startListener(): Promise<void> {
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
  };
}
