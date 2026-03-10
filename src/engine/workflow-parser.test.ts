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
});
