import type { IngestorChannel } from "@/ingestor/ingestor-channel.js";
import type { Ingestor } from "@/ingestor/ingestor.js";
import { createSlackChannel } from "./slack/index.js";
import { createGithubWebhookChannel } from "./github-webhook/index.js";
import { createGithubPollChannel } from "./github-poll/index.js";

export function getAllChannels(ingestor: Ingestor): IngestorChannel[] {
  return [
    createSlackChannel(ingestor),
    createGithubWebhookChannel(ingestor),
    createGithubPollChannel(ingestor),
  ];
}
