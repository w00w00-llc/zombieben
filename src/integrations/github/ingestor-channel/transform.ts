import type { Trigger } from "@/ingestor/trigger.js";
import type { GithubRepoEvent } from "./types.js";

export function repoSlugToOwnerRepo(
  repoSlug: string,
): { owner: string; repo: string } | null {
  const idx = repoSlug.indexOf("--");
  if (idx <= 0 || idx >= repoSlug.length - 2) return null;
  return {
    owner: repoSlug.slice(0, idx),
    repo: repoSlug.slice(idx + 2),
  };
}

export function transformGithubPolledEvent(
  repoSlug: string,
  ownerRepo: string,
  event: GithubRepoEvent,
): Trigger {
  const triggerId = `github-${repoSlug}-${event.id}`;
  const eventRepo = event.repo?.name || ownerRepo;
  const groupKeys = buildGithubGroupKeys(eventRepo, event.payload);

  return {
    source: "github_poll",
    id: triggerId,
    groupKeys,
    timestamp: event.created_at || new Date().toISOString(),
    raw_payload: event,
    context: {
      repoSlug,
      ownerRepo: eventRepo,
      eventType: event.type,
      ...(event.actor?.login ? { actor: event.actor.login } : {}),
    },
  };
}

export function transformGithubWebhookEvent(
  eventType: string,
  deliveryId: string,
  payload: Record<string, unknown>,
): Trigger {
  const ownerRepo = extractOwnerRepo(payload);
  const groupKeys = buildGithubGroupKeys(ownerRepo, payload);
  return {
    source: "github_webhook",
    id: `github-webhook-${deliveryId}`,
    groupKeys,
    timestamp: new Date().toISOString(),
    raw_payload: payload,
    context: {
      ownerRepo,
      eventType,
      deliveryId,
    },
  };
}

export function buildGithubGroupKeys(
  ownerRepo: string,
  payload?: Record<string, unknown>,
): string[] {
  const keys = new Set<string>([`github:${ownerRepo}`]);

  const pr = extractPrNumber(payload);
  if (pr != null) keys.add(`github:${ownerRepo}:pr:${pr}`);

  const issue = extractIssueNumber(payload);
  if (issue != null) keys.add(`github:${ownerRepo}:issue:${issue}`);

  return [...keys];
}

export function extractPrNumber(payload?: Record<string, unknown>): number | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const directPr = readNumber((payload as Record<string, unknown>).pull_request, "number");
  if (directPr != null) return directPr;
  const number = readNumber(payload, "number");
  if (number != null) return number;
  const issue = (payload as Record<string, unknown>).issue;
  if (isRecord(issue) && issue.pull_request != null) {
    return readNumber(issue, "number");
  }
  return undefined;
}

export function extractIssueNumber(payload?: Record<string, unknown>): number | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const issue = (payload as Record<string, unknown>).issue;
  if (isRecord(issue)) {
    return readNumber(issue, "number");
  }
  return undefined;
}

export function extractOwnerRepo(payload: Record<string, unknown>): string {
  const repo = payload.repository;
  if (!isRecord(repo)) {
    throw new Error("GitHub webhook payload is missing repository");
  }
  const fullName = repo.full_name;
  if (typeof fullName !== "string" || !fullName.includes("/")) {
    throw new Error("GitHub webhook payload has invalid repository.full_name");
  }
  return fullName;
}

function readNumber(obj: unknown, key: string): number | undefined {
  if (!isRecord(obj)) return undefined;
  const value = obj[key];
  return typeof value === "number" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
