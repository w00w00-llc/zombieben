import type { IngestorChannel } from "@/ingestor/ingestor-channel.js";
import type { Ingestor } from "@/ingestor/ingestor.js";

export function createGithubWebhookChannel(_ingestor: Ingestor): IngestorChannel {
  return {
    name: "github-webhook",
    isEnabled: () => false,
    startListener: async () => {},
    stopListener: async () => {},
  };
}
