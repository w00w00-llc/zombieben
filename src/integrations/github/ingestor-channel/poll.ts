import type { IngestorChannel } from "@/ingestor/ingestor-channel.js";

export function createGithubPollChannel(): IngestorChannel {
  return {
    name: "github-poll",
    isEnabled: () => false,
    startListener: async () => {},
    stopListener: async () => {},
    getPrimaryResponder() {
      throw new Error("GitHub poll responder not implemented");
    },
    getChannelKey() {
      throw new Error("GitHub poll channel key not implemented");
    },
  };
}
