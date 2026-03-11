import { describe, expect, it } from "vitest";
import { parseWorkflow } from "./workflow-parser.js";

describe("parseWorkflow", () => {
  it("parses core workflow fields", () => {
    const workflow = parseWorkflow(
      [
        "name: Implement Task",
        "confirmation_required: true",
        "inputs:",
        "  issue:",
        "    description: Issue number",
        "    required: true",
        "    type: string",
        "steps:",
        "  - name: do-work",
        "    prompt: Implement issue ${{ inputs.issue }}",
      ].join("\n"),
    );

    expect(workflow.name).toBe("Implement Task");
    expect(workflow.confirmation_required).toBe(true);
    expect(workflow.inputs?.issue?.type).toBe("string");
    expect(workflow.steps).toHaveLength(1);
  });

  it("silently ignores legacy top-level triggers key", () => {
    const workflow = parseWorkflow(
      [
        "name: Legacy Trigger Workflow",
        "triggers:",
        "  slack:",
        "    - mention",
        "  github:",
        "    - pull_request",
        "steps:",
        "  - name: do-work",
        "    prompt: Run task",
      ].join("\n"),
    );

    expect("triggers" in (workflow as unknown as object)).toBe(false);
    expect(workflow.name).toBe("Legacy Trigger Workflow");
    expect(workflow.steps).toHaveLength(1);
  });

  it("parses foreach step and extracts parameter from first token", () => {
    const workflow = parseWorkflow(
      [
        "name: Foreach Workflow",
        "steps:",
        "  - name: Iterate Lines",
        "    foreach: line in ./foreach.txt",
        "    steps:",
        "      - name: append",
        "        prompt: Append {line} to ./foreach.txt",
      ].join("\n"),
    );

    expect(workflow.steps).toHaveLength(1);
    expect(workflow.steps[0]).toMatchObject({
      kind: "foreach",
      foreach: "line in ./foreach.txt",
      parameter: "line",
    });
  });

  it("normalizes freeform if conditions into success-path ai conditions", () => {
    const workflow = parseWorkflow(
      [
        "name: Conditional Workflow",
        "steps:",
        "  - name: maybe-run",
        "    if: the generated file contains at least one error",
        "    prompt: Fix the file",
      ].join("\n"),
    );

    expect(workflow.steps[0]).toMatchObject({
      kind: "prompt",
      condition: {
        outcome: "success",
        ai_condition: "the generated file contains at least one error",
      },
    });
  });

  it("parses nested workflow steps and normalizes bare brace placeholders", () => {
    const workflow = parseWorkflow(
      [
        "name: Outer",
        "steps:",
        "  - name: nested",
        "    workflow:",
        "      name: ./inner.yml",
        "      inputs:",
        "        number: {The value in ./outer.txt}",
      ].join("\n"),
    );

    expect(workflow.steps[0]).toMatchObject({
      kind: "workflow",
      workflow: {
        name: "./inner.yml",
        inputs: {
          number: "{The value in ./outer.txt}",
        },
      },
    });
  });
});
