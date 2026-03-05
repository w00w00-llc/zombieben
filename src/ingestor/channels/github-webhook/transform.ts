import type { Trigger } from "@/ingestor/trigger.js";

interface GitHubWebhookEvent {
  action?: string;
  [key: string]: unknown;
}

export function transformGithubWebhookEvent(raw: unknown): Trigger {
  const event = raw as GitHubWebhookEvent;
  return {
    source: "github_webhook",
    id: `github-webhook-${Date.now()}`,
    timestamp: new Date().toISOString(),
    raw_payload: event,
  };
}
