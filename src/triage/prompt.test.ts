import { describe, it, expect, vi } from "vitest";
import { buildTriagePrompt } from "./prompt.js";
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

  it("includes file path patterns for workflows and runs", () => {
    const prompt = buildTriagePrompt(makeTrigger());
    expect(prompt).toContain("/home/test/.zombieben/repos/*/main_repo/.zombieben/workflows/*.yml");
    expect(prompt).toContain("/home/test/.zombieben/repos/*/tasks/*/workflow_state.json");
    expect(prompt).toContain("/home/test/.zombieben/repos/*/tasks/*/trigger.json");
  });

  it("includes thread history when present", () => {
    const prompt = buildTriagePrompt(makeTrigger({
      context: {
        allThreadMessages: [
          { user: "U1", ts: "1000.0", text: "first message" },
          { user: "U2", ts: "1001.0", text: "second message" },
        ],
      },
    }));
    expect(prompt).toContain("[1000.0] U1: first message");
    expect(prompt).toContain("[1001.0] U2: second message");
  });

  it("indicates no thread history for top-level messages", () => {
    const prompt = buildTriagePrompt(makeTrigger());
    expect(prompt).toContain("No thread history");
  });

  it("includes the decision tree for NewWorkflow sub-outcomes", () => {
    const prompt = buildTriagePrompt(makeTrigger());
    expect(prompt).toContain("confirmation_required");
    expect(prompt).toContain("high confidence");
    expect(prompt).toContain("low confidence");
  });

  it("includes all three outcome type examples", () => {
    const prompt = buildTriagePrompt(makeTrigger());
    expect(prompt).toContain('"kind": "new_workflow"');
    expect(prompt).toContain('"kind": "in_progress_workflow_adjustment"');
    expect(prompt).toContain('"kind": "immediate_response"');
  });
});
