import { describe, it, expect } from "vitest";
import {
  repoSlugToOwnerRepo,
  transformGithubPolledEvent,
  transformGithubPolledWorkflowRun,
  transformGithubWebhookEvent,
} from "./transform.js";

describe("repoSlugToOwnerRepo", () => {
  it("parses owner--repo slugs", () => {
    expect(repoSlugToOwnerRepo("w00w00-llc--ami")).toEqual({
      owner: "w00w00-llc",
      repo: "ami",
    });
  });

  it("returns null for invalid slugs", () => {
    expect(repoSlugToOwnerRepo("invalid-slug")).toBeNull();
  });
});

describe("transformGithubPolledEvent", () => {
  it("builds deterministic trigger id and PR group key", () => {
    const trigger = transformGithubPolledEvent(
      "w00w00-llc--ami",
      "w00w00-llc/ami",
      {
        id: "123456",
        type: "PullRequestReviewEvent",
        created_at: "2026-03-08T00:00:00Z",
        repo: { name: "w00w00-llc/ami" },
        payload: {
          action: "submitted",
          pull_request: { number: 3850 },
        },
        actor: { login: "octocat" },
      },
    );

    expect(trigger.source).toBe("github_poll");
    expect(trigger.id).toBe("github-w00w00-llc--ami-123456");
    expect(trigger.groupKeys).toContain("github:w00w00-llc/ami");
    expect(trigger.groupKeys).toContain("github:w00w00-llc/ami:pr:3850");
    expect(trigger.timestamp).toBe("2026-03-08T00:00:00Z");
  });

  it("adds issue and PR grouping for issue comment on PR", () => {
    const trigger = transformGithubPolledEvent(
      "w00w00-llc--ami",
      "w00w00-llc/ami",
      {
        id: "123457",
        type: "IssueCommentEvent",
        created_at: "2026-03-08T00:00:01Z",
        payload: {
          issue: {
            number: 3850,
            pull_request: { url: "https://api.github.com/repos/w00w00-llc/ami/pulls/3850" },
          },
        },
      },
    );

    expect(trigger.groupKeys).toContain("github:w00w00-llc/ami");
    expect(trigger.groupKeys).toContain("github:w00w00-llc/ami:issue:3850");
    expect(trigger.groupKeys).toContain("github:w00w00-llc/ami:pr:3850");
  });
});

describe("transformGithubWebhookEvent", () => {
  it("builds deterministic webhook trigger and group keys", () => {
    const trigger = transformGithubWebhookEvent(
      "pull_request",
      "deliv-1",
      {
        repository: { full_name: "w00w00-llc/ami" },
        pull_request: { number: 3850 },
      },
    );

    expect(trigger.source).toBe("github_webhook");
    expect(trigger.id).toBe("github-webhook-deliv-1");
    expect(trigger.groupKeys).toContain("github:w00w00-llc/ami");
    expect(trigger.groupKeys).toContain("github:w00w00-llc/ami:pr:3850");
  });
});

describe("transformGithubPolledWorkflowRun", () => {
  it("builds deterministic poll trigger for completed workflow run", () => {
    const trigger = transformGithubPolledWorkflowRun(
      "w00w00-llc--ami",
      "w00w00-llc/ami",
      {
        id: 987654,
        name: "e2e",
        head_branch: "zb/implement-task-123",
        head_sha: "abc123",
        conclusion: "failure",
        updated_at: "2026-03-08T00:00:10Z",
        actor: { login: "octocat" },
        pull_requests: [{ number: 3850 }],
      },
    );

    expect(trigger.source).toBe("github_poll");
    expect(trigger.id).toBe("github-w00w00-llc--ami-workflow-run-987654");
    expect(trigger.timestamp).toBe("2026-03-08T00:00:10Z");
    expect(trigger.groupKeys).toContain("github:w00w00-llc/ami");
    expect(trigger.groupKeys).toContain("github:w00w00-llc/ami:pr:3850");
    expect(trigger.groupKeys).toContain("github:w00w00-llc/ami:branch:zb/implement-task-123");
  });
});
