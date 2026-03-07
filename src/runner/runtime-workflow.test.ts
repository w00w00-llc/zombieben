import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { WorkflowDef } from "@/engine/workflow-types.js";
import { prepareWorkflowForRun } from "./runtime-workflow.js";

const TEST_DIR = path.join(os.tmpdir(), "zombieben-runtime-workflow-test");

describe("prepareWorkflowForRun", () => {
  beforeEach(() => {
    process.env.ZOMBIEBEN_RUNNER_DIR = TEST_DIR;
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    delete process.env.ZOMBIEBEN_RUNNER_DIR;
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("prepends setup_steps for create workflows and marks section metadata", () => {
    const configPath = path.join(
      TEST_DIR,
      "repos",
      "my-org--my-repo",
      "main_repo",
      ".zombieben",
      "worktrees.yml",
    );
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      "setup_steps:\n  - name: install\n    prompt: Install deps\ncleanup_on: []\n",
    );

    const workflow: WorkflowDef = {
      name: "Build Feature",
      steps: [{ kind: "prompt", name: "implement", prompt: "Implement it" }],
    };

    const prepared = prepareWorkflowForRun("my-org--my-repo", workflow);
    expect(prepared.steps).toHaveLength(2);
    expect(prepared.worktree_setup_start_index).toBe(0);
    expect(prepared.worktree_setup_count).toBe(1);
    expect(prepared.steps[0].name).toBe("install");
    expect(prepared.steps[1].name).toBe("implement");
  });

  it("does not prepend setup_steps for inherit workflows", () => {
    const workflow: WorkflowDef = {
      name: "Follow Up",
      worktree: { action: "inherit" },
      steps: [{ kind: "prompt", name: "check", prompt: "Check status" }],
    };

    const prepared = prepareWorkflowForRun("my-org--my-repo", workflow);
    expect(prepared.steps).toHaveLength(1);
    expect(prepared.worktree_setup_start_index).toBeUndefined();
  });
});
