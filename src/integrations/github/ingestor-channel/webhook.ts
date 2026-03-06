import type { IngestorChannel } from "@/ingestor/ingestor-channel.js";

export function createGithubWebhookChannel(): IngestorChannel {
  return {
    name: "github-webhook",
    isEnabled: () => false,
    startListener: async () => {},
    stopListener: async () => {},
    getPrimaryResponder() {
      throw new Error("GitHub webhook responder not implemented");
    },
    getChannelKey() {
      throw new Error("GitHub webhook channel key not implemented");
    },
  };
}
