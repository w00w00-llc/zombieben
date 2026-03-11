import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadWorkflowFromFile } from "./workflow-loader.js";

describe("loadWorkflowFromFile", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "zombieben-workflow-loader-"));
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("expands nested workflows inline, substitutes child inputs, and drops impossible merged conditions", () => {
    fs.writeFileSync(
      path.join(testDir, "inner.yml"),
      [
        "name: Inner",
        "inputs:",
        "  number:",
        "    description: A number to write",
        "    required: true",
        "    type: number",
        "steps:",
        "  - name: write",
        "    prompt: Write ${{ inputs.number }} to ./inner.txt",
        "  - name: cleanup",
        "    if: always",
        "    prompt: Clean up any temp files",
        "  - name: failure-only",
        "    if: failure",
        "    prompt: Report nested failure",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(testDir, "outer.yml"),
      [
        "name: Outer",
        "steps:",
        "  - name: make-number",
        "    prompt: Create ./outer.txt",
        "  - name: nested",
        "    if: The value in ./outer.txt is greater than 0.5",
        "    workflow:",
        "      name: ${{ workflows.inner }}",
        "      inputs:",
        "        number: {The value in ./outer.txt}",
      ].join("\n"),
    );

    const workflow = loadWorkflowFromFile(path.join(testDir, "outer.yml"), {
      rootDir: testDir,
    });

    expect(workflow.steps).toHaveLength(3);
    expect(workflow.steps[1]).toMatchObject({
      kind: "prompt",
      name: "write",
      prompt: "Write {The value in ./outer.txt} to ./inner.txt",
      condition: {
        outcome: "success",
        ai_condition: "The value in ./outer.txt is greater than 0.5",
      },
    });
    expect(workflow.steps[2]).toMatchObject({
      kind: "prompt",
      name: "cleanup",
      condition: {
        outcome: "success",
        ai_condition: "The value in ./outer.txt is greater than 0.5",
      },
    });
    expect(workflow.steps.find((step) => step.name === "failure-only")).toBeUndefined();
  });

  it("rejects missing required nested inputs", () => {
    fs.writeFileSync(
      path.join(testDir, "inner.yml"),
      [
        "name: Inner",
        "inputs:",
        "  number:",
        "    description: A number to write",
        "    required: true",
        "    type: number",
        "steps:",
        "  - name: write",
        "    prompt: Write ${{ inputs.number }}",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(testDir, "outer.yml"),
      [
        "name: Outer",
        "steps:",
        "  - name: nested",
        "    workflow:",
        "      name: ./inner.yml",
      ].join("\n"),
    );

    expect(() => loadWorkflowFromFile(path.join(testDir, "outer.yml"), {
      rootDir: testDir,
    })).toThrow(/missing required inputs/i);
  });

  it("rejects nested workflow cycles", () => {
    fs.writeFileSync(
      path.join(testDir, "a.yml"),
      [
        "name: A",
        "steps:",
        "  - name: go-b",
        "    workflow:",
        "      name: ./b.yml",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(testDir, "b.yml"),
      [
        "name: B",
        "steps:",
        "  - name: go-a",
        "    workflow:",
        "      name: ./a.yml",
      ].join("\n"),
    );

    expect(() => loadWorkflowFromFile(path.join(testDir, "a.yml"), {
      rootDir: testDir,
    })).toThrow(/cycle detected/i);
  });
});
