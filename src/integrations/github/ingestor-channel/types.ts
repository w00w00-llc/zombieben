import type { Trigger } from "@/ingestor/trigger.js";

export interface GithubRepoEvent {
  id: string;
  type: string;
  created_at: string;
  repo?: {
    name?: string;
  };
  payload?: Record<string, unknown>;
  actor?: {
    login?: string;
  };
}

export interface GithubWorkflowRun {
  id: number;
  name?: string;
  head_branch?: string;
  head_sha?: string;
  conclusion?: string | null;
  created_at?: string;
  updated_at?: string;
  actor?: {
    login?: string;
  };
  pull_requests?: Array<{
    number?: number;
  }>;
}

export type GithubPollTrigger = Trigger & {
  source: "github_poll";
  raw_payload: GithubRepoEvent;
  context?: {
    repoSlug: string;
    ownerRepo: string;
    eventType: string;
    actor?: string;
  };
};

export type GithubWebhookTrigger = Trigger & {
  source: "github_webhook";
  raw_payload: Record<string, unknown>;
  context?: {
    ownerRepo: string;
    eventType: string;
    deliveryId: string;
  };
};

export function isGithubPollTrigger(trigger: Trigger): trigger is GithubPollTrigger {
  return trigger.source === "github_poll";
}

export function isGithubWebhookTrigger(trigger: Trigger): trigger is GithubWebhookTrigger {
  return trigger.source === "github_webhook";
}
