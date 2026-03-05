import type { IngestorChannel } from "@/ingestor/ingestor-channel.js";
import type { Ingestor } from "@/ingestor/ingestor.js";

export function createGithubPollChannel(_ingestor: Ingestor): IngestorChannel {
  return {
    name: "github-poll",
    isEnabled: () => false,
    startListener: async () => {},
    stopListener: async () => {},
  };
}
