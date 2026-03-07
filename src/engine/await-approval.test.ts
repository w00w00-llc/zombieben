import { describe, it, expect, vi } from "vitest";
import { shouldAwaitApprovalForPrompt } from "./await-approval.js";
import type { PromptStepDef } from "./workflow-types.js";

describe("shouldAwaitApprovalForPrompt", () => {
  const baseStep: PromptStepDef = {
    kind: "prompt",
    name: "Create Plan",
    prompt: "Make a plan",
    await_approval: { enabled: "${{ inputs.plan_approval_required }}" },
  };

  it("returns true when template resolves to true", () => {
    const shouldAwait = shouldAwaitApprovalForPrompt(baseStep, {
      inputs: { plan_approval_required: true },
    });
    expect(shouldAwait).toBe(true);
  });

  it("returns false when template resolves to false", () => {
    const shouldAwait = shouldAwaitApprovalForPrompt(baseStep, {
      inputs: { plan_approval_required: false },
    });
    expect(shouldAwait).toBe(false);
  });

  it("defaults to true for invalid values and logs warning", () => {
    const warn = vi.fn();
    const shouldAwait = shouldAwaitApprovalForPrompt(
      baseStep,
      { inputs: { plan_approval_required: "maybe" } },
      {
        debug: () => {},
        info: () => {},
        warn,
        error: () => {},
        tee: false,
      },
    );
    expect(shouldAwait).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("Invalid await_approval.enabled");
  });
});

