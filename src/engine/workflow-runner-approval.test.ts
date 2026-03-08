import { describe, it, expect } from "vitest";
import { advanceWorkflow } from "./workflow-runner.js";
import type { WorkflowDef } from "./workflow-types.js";
import type { WorkflowRunState } from "./workflow-run-state.js";
import type { TemplateContext } from "./workflow-template.js";

function makeWorkflow(): WorkflowDef {
  return {
    name: "Test",
    steps: [
      { kind: "prompt", name: "step-1", prompt: "one" },
      {
        kind: "prompt",
        name: "step-2",
        prompt: "two",
        await_approval: { enabled: "${{ inputs.plan_approval_required }}" },
      },
    ],
  };
}

function makeState(): WorkflowRunState {
  const now = new Date().toISOString();
  return {
    workflow_name: "Test",
    workflow_file: "test.yml",
    status: "running",
    step_index: 0,
    step_name: "step-1",
    attempt: 1,
    max_attempts: 1,
    inputs: {},
    artifacts: {},
    created_at: now,
    updated_at: now,
  };
}

describe("advanceWorkflow approval gating", () => {
  it("moves to awaiting_approval when enabled resolves true", () => {
    const context: TemplateContext = { inputs: { plan_approval_required: true } };
    const result = advanceWorkflow(
      makeWorkflow(),
      makeState(),
      { success: true },
      context,
    );
    expect(result.action).toBe("awaiting_approval");
    expect(result.state.status).toBe("awaiting_approval");
    expect(result.state.step_index).toBe(1);
  });

  it("continues running when enabled resolves false", () => {
    const context: TemplateContext = { inputs: { plan_approval_required: false } };
    const result = advanceWorkflow(
      makeWorkflow(),
      makeState(),
      { success: true },
      context,
    );
    expect(result.action).toBe("next");
    expect(result.state.status).toBe("running");
    expect(result.state.step_index).toBe(1);
  });

  it("defaults to awaiting_approval when enabled resolves invalid", () => {
    const context: TemplateContext = { inputs: { plan_approval_required: "maybe" } };
    const result = advanceWorkflow(
      makeWorkflow(),
      makeState(),
      { success: true },
      context,
    );
    expect(result.action).toBe("awaiting_approval");
    expect(result.state.status).toBe("awaiting_approval");
  });

  it("completes immediately when executeWorkflowSlice reports todoFullyComplete", () => {
    const result = advanceWorkflow(
      makeWorkflow(),
      makeState(),
      { success: true, todoFullyComplete: true },
      { inputs: { plan_approval_required: true } },
    );
    expect(result.action).toBe("completed");
    expect(result.state.status).toBe("completed");
    expect(result.state.step_index).toBe(1);
  });

  it("fails when todo is fully complete but intent is not aligned", () => {
    const result = advanceWorkflow(
      makeWorkflow(),
      makeState(),
      {
        success: true,
        todoFullyComplete: true,
        intentAligned: false,
        summary: "intent review missing",
      },
      { inputs: { plan_approval_required: true } },
    );
    expect(result.action).toBe("failed");
    expect(result.state.status).toBe("failed");
    expect(result.state.error).toContain("intent review missing");
  });
});
