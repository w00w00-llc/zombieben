import type { IngestorChannel } from "@/ingestor/ingestor-channel.js";
import { createSlackChannel } from "@/integrations/slack/ingestor-channel/index.js";
import { createGithubWebhookChannel } from "@/integrations/github/ingestor-channel/webhook.js";
import { createGithubPollChannel } from "@/integrations/github/ingestor-channel/poll.js";

export function getAllChannels(): IngestorChannel[] {
  return [
    createSlackChannel(),
    createGithubWebhookChannel(),
    createGithubPollChannel(),
  ];
}
