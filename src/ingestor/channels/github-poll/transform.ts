import type { Trigger } from "@/ingestor/trigger.js";

interface GitHubPollEvent {
  [key: string]: unknown;
}

export function transformGithubPollEvent(raw: unknown): Trigger {
  const event = raw as GitHubPollEvent;
  return {
    source: "github_poll",
    id: `github-poll-${Date.now()}`,
    timestamp: new Date().toISOString(),
    raw_payload: event,
  };
}
