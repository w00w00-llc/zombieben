import { describe, it, expect, vi } from "vitest";
import { buildTriageSystemPrompt, buildTriagePrompt } from "./prompt.js";
import type { Trigger } from "@/ingestor/trigger.js";

vi.mock("../util/paths.js", () => ({
  reposDir: () => "/home/test/.zombieben/repos",
}));

function makeTrigger(overrides: Partial<Trigger> = {}): Trigger {
  return {
    source: "slack_webhook",
    id: "slack-C123-1234.5678",
    groupKeys: ["slack:C123:1234.5678"],
    timestamp: "2026-03-05T00:00:00Z",
    raw_payload: { channel: "C123", ts: "1234.5678", user: "U456", text: "implement TASK-1234" },
    ...overrides,
  };
}

describe("buildTriageSystemPrompt", () => {
  it("includes file path patterns for workflows and runs", () => {
    const prompt = buildTriageSystemPrompt();
    expect(prompt).toContain("/home/test/.zombieben/repos/*/main_repo/.zombieben/workflows/*.yml");
    expect(prompt).toContain("workflow_state.json");
    expect(prompt).toContain("trigger.json");
  });

  it("includes the decision tree for NewWorkflow sub-outcomes", () => {
    const prompt = buildTriageSystemPrompt();
    expect(prompt).toContain("confirmation_required");
    expect(prompt).toContain("high confidence");
    expect(prompt).toContain("low confidence");
  });

  it("includes retry_fresh guidance for related failed runs", () => {
    const prompt = buildTriageSystemPrompt();
    expect(prompt).toContain("retry_fresh");
    expect(prompt).toContain("including failed/completed runs");
  });

  it("includes link-correlation and immediate_response guardrails", () => {
    const prompt = buildTriageSystemPrompt();
    expect(prompt).toContain("Follow links in the trigger message");
    expect(prompt).toContain("correlate with local state");
    expect(prompt).toContain("Search run trigger history");
    expect(prompt).toContain('Never claim "no workflows configured"');
    expect(prompt).toContain("avoid unverifiable capability claims");
  });

  it("includes inherit workflow validity checks", () => {
    const prompt = buildTriageSystemPrompt();
    expect(prompt).toContain("worktree.action: inherit");
    expect(prompt).toContain("MUST provide a valid related `worktreeId`");
    expect(prompt).toContain("do not return `new_workflow/run`");
  });

  it("includes output hardening script", () => {
    const prompt = buildTriageSystemPrompt();
    expect(prompt).toContain("Output Hardening Script");
    expect(prompt).toContain("function harden(candidate, workflows, runs)");
    expect(prompt).toContain("requireLinkCorrelationEvidence");
  });

  it("includes validateRun source-of-truth pointer and required behavior", () => {
    const prompt = buildTriageSystemPrompt();
    expect(prompt).toContain("Run validation logic");
    expect(prompt).toContain("validate-run");
    expect(prompt).toContain("evaluate your candidate output");
    expect(prompt).toContain("would fail, adjust your output");
  });

  it("includes JSON schema with all three outcome kinds", () => {
    const prompt = buildTriageSystemPrompt();
    expect(prompt).toContain('"new_workflow"');
    expect(prompt).toContain('"in_progress_workflow_adjustment"');
    expect(prompt).toContain('"immediate_response"');
  });

  it("includes the schema from types.ts", () => {
    const prompt = buildTriageSystemPrompt();
    expect(prompt).toContain('"oneOf"');
    expect(prompt).toContain('"required"');
  });
});

describe("buildTriagePrompt", () => {
  it("includes trigger text in the prompt", () => {
    const prompt = buildTriagePrompt(makeTrigger());
    expect(prompt).toContain("implement TASK-1234");
  });

  it("includes trigger source and ID", () => {
    const prompt = buildTriagePrompt(makeTrigger());
    expect(prompt).toContain("slack_webhook");
    expect(prompt).toContain("slack-C123-1234.5678");
  });

  it("includes group keys", () => {
    const prompt = buildTriagePrompt(makeTrigger({
      groupKeys: ["slack:C123:1000.0", "slack:C123:1234.5678"],
    }));
    expect(prompt).toContain("slack:C123:1000.0");
    expect(prompt).toContain("slack:C123:1234.5678");
  });

  it("includes context when present", () => {
    const prompt = buildTriagePrompt(makeTrigger({
      context: {
        allThreadMessages: [
          { user: "U1", ts: "1000.0", text: "first message" },
          { user: "U2", ts: "1001.0", text: "second message" },
        ],
      },
    }));
    expect(prompt).toContain("first message");
    expect(prompt).toContain("second message");
  });

  it("omits context line for top-level messages", () => {
    const prompt = buildTriagePrompt(makeTrigger());
    expect(prompt).not.toContain("**Context**");
  });

  it("does not include instructions or outcome types", () => {
    const prompt = buildTriagePrompt(makeTrigger());
    expect(prompt).not.toContain("Outcome Types");
    expect(prompt).not.toContain("Output Format");
  });
});
