import { describe, it, expect } from "vitest";
import type { TriageOutcome } from "@/triage/types.js";
import { formatSlackOutcomeText } from "./outcome-format.js";

describe("formatSlackOutcomeText", () => {
  it("formats new_workflow run with structured inputs", () => {
    const outcome: TriageOutcome = {
      kind: "new_workflow",
      resolution: {
        type: "run",
        repoSlug: "org/repo",
        workflowFile: "fix.yml",
        workflowName: "Fix",
        inputs: { issue: "123" },
      },
      reasoning: "matched",
    };

    const msg = formatSlackOutcomeText(outcome);
    expect(msg).toContain("Triage: new_workflow/run");
    expect(msg).toContain("Inputs:");
    expect(msg).toContain("*issue:* 123");
  });

  it("formats new_workflow confirm with structured inputs", () => {
    const outcome: TriageOutcome = {
      kind: "new_workflow",
      resolution: {
        type: "confirm",
        repoSlug: "org/repo",
        workflowFile: "deploy.yml",
        workflowName: "Deploy",
        inputs: { environment: "prod" },
      },
      reasoning: "confirm required",
    };

    const msg = formatSlackOutcomeText(outcome);
    expect(msg).toContain("Triage: new_workflow/confirm");
    expect(msg).toContain("Inputs:");
    expect(msg).toContain("*environment:* prod");
  });

  it("formats new_workflow suggest with per-suggestion input blocks", () => {
    const outcome: TriageOutcome = {
      kind: "new_workflow",
      resolution: {
        type: "suggest",
        prompt: "Which workflow?",
        suggestions: [
          {
            repoSlug: "org/repo-a",
            workflowFile: "build.yml",
            workflowName: "Build",
            inputs: { target: "web" },
            description: "Build project",
          },
          {
            repoSlug: "org/repo-b",
            workflowFile: "test.yml",
            workflowName: "Test",
            inputs: {},
            description: "Run tests",
          },
        ],
      },
      reasoning: "ambiguous",
    };

    const msg = formatSlackOutcomeText(outcome);
    expect(msg).toContain("Triage: new_workflow/suggest");
    expect(msg).toContain("  Inputs:");
    expect(msg).toContain("  - *target:* web");
    expect(msg).toContain("  - (none)");
  });
});
