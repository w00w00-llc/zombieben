import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";
import { initRun } from "./init-run.js";
import type { RunInitRequest } from "./init-run.js";
import type { Trigger } from "@/ingestor/trigger.js";
import { createWorktree } from "../engine/worktree.js";
import { syncRepo, rebaseWorktreeOntoDefaultBranch } from "./repo-sync.js";
import { worktreeMetadataPath } from "@/util/paths.js";

const TEST_DIR = path.join(os.tmpdir(), "zombieben-init-run-test");

vi.mock("../util/logger.js", () => ({
  log: { info: vi.fn(), error: vi.fn() },
}));

vi.mock("../engine/worktree.js", () => ({
  createWorktree: vi.fn().mockResolvedValue("/mock/worktree/path"),
}));

vi.mock("./repo-sync.js", () => ({
  syncRepo: vi.fn().mockResolvedValue(undefined),
  rebaseWorktreeOntoDefaultBranch: vi.fn().mockResolvedValue(undefined),
}));

describe("initRun", () => {
  beforeEach(() => {
    process.env.ZOMBIEBEN_RUNNER_DIR = TEST_DIR;
    fs.mkdirSync(TEST_DIR, { recursive: true });

    // Create a mock workflow file (default: no worktree config = "create")
    const workflowsDir = path.join(
      TEST_DIR,
      "repos",
      "my-org--my-repo",
      "main_repo",
      ".zombieben",
      "workflows",
    );
    fs.mkdirSync(workflowsDir, { recursive: true });
    fs.writeFileSync(
      path.join(workflowsDir, "fix-bug.yml"),
      `name: Fix Bug\ninputs:\n  issue:\n    description: Issue number\n    required: true\n    type: string\nsteps:\n  - name: do-it\n    prompt: Fix issue \${{ inputs.issue }}\n  - name: notify\n    prompt: Reply via \${{ zombieben.trigger }}\n  - name: save\n    prompt: Store output in \${{ artifacts.plan }}\n`,
    );
    fs.writeFileSync(
      path.join(workflowsDir, "followup.yml"),
      `name: Follow Up\nworktree:\n  action: inherit\n  parents:\n    - fix-bug\nsteps:\n  - name: check\n    prompt: Check the fix\n`,
    );
    fs.writeFileSync(
      path.join(workflowsDir, "nested-inner.yml"),
      `name: Nested Inner\ninputs:\n  number:\n    description: Number to write\n    required: true\n    type: number\nsteps:\n  - name: write-number\n    prompt: Write \${{ inputs.number }} to ./nested-inner.txt\n`,
    );
    fs.writeFileSync(
      path.join(workflowsDir, "nested-outer.yml"),
      `name: Nested Outer\nsteps:\n  - name: generate\n    prompt: Create ./nested-outer.txt\n  - name: maybe-inline\n    if: The value in ./nested-outer.txt is greater than 0.5\n    workflow:\n      name: ./nested-inner.yml\n      inputs:\n        number: {The value in ./nested-outer.txt}\n`,
    );
    fs.writeFileSync(
      path.join(workflowsDir, "worktree-metadata.yml"),
      `name: Worktree Metadata\nworktree:\n  action: inherit\nsteps:\n  - name: summarize\n    prompt: Recording id is \${{ worktree_metadata.capture_screen_recordings_run_id }} and metadata file is \${{ worktree.metadata_path }}\n`,
    );
  });

  afterEach(() => {
    delete process.env.ZOMBIEBEN_RUNNER_DIR;
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("creates directory structure with runs/{runId}/workflow_state.json, trigger.json, responders.json, inputs.json, and user_intent.md", async () => {
    const triageResult: RunInitRequest = {
      repoSlug: "my-org--my-repo",
      workflowFile: "fix-bug.yml",
      workflowName: "Fix Bug",
      inputs: { issue: "123" },
    };

    const trigger: Trigger = {
      source: "slack",
      id: "slack-C123-1234.5678",
      groupKeys: ["slack:C123:1234.5678"],
      timestamp: new Date().toISOString(),
      raw_payload: { channel: "C123", ts: "1234.5678", text: "hello" },
      context: { allThreadMessages: [{ text: "hello" }] },
    };

    const result = await initRun(triageResult, trigger);

    expect(result.repoSlug).toBe("my-org--my-repo");
    expect(result.worktreeId).toMatch(/^\d+-fix-bug$/);
    expect(result.runId).toBe(result.worktreeId); // For "create", runId === worktreeId
    expect(syncRepo).toHaveBeenCalledWith("my-org--my-repo");
    expect(createWorktree).toHaveBeenCalledWith("my-org--my-repo", result.worktreeId);
    expect(rebaseWorktreeOntoDefaultBranch).toHaveBeenCalledWith(
      "my-org--my-repo",
      result.worktreeId,
      undefined,
    );

    // Check runs/{runId}/workflow_state.json
    const tasksDir = path.join(TEST_DIR, "repos", "my-org--my-repo", "tasks");
    const runDir = path.join(tasksDir, result.worktreeId, "runs", result.runId);

    const statePath = path.join(runDir, "workflow_state.json");
    expect(fs.existsSync(statePath)).toBe(true);
    const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    expect(state.workflow_name).toBe("Fix Bug");
    expect(state.workflow_file).toBe("fix-bug.yml");
    expect(state.status).toBe("running");
    expect(state.inputs).toEqual({ issue: "123" });

    // Check trigger.json
    const triggerPath = path.join(runDir, "trigger.json");
    expect(fs.existsSync(triggerPath)).toBe(true);
    const triggerData = JSON.parse(fs.readFileSync(triggerPath, "utf-8"));
    expect(triggerData).toEqual(trigger);

    // Check responders.json
    const respondersPath = path.join(runDir, "responders.json");
    expect(fs.existsSync(respondersPath)).toBe(true);
    const respondersData = JSON.parse(fs.readFileSync(respondersPath, "utf-8"));
    expect(respondersData.version).toBe(1);
    expect(respondersData.triggerId).toBe(trigger.id);
    expect(Array.isArray(respondersData.entries)).toBe(true);

    // Check inputs.json
    const inputsPath = path.join(runDir, "inputs.json");
    expect(fs.existsSync(inputsPath)).toBe(true);
    const inputsData = JSON.parse(fs.readFileSync(inputsPath, "utf-8"));
    expect(inputsData).toEqual({ issue: "123" });

    // Check user_intent.md
    const intentPath = path.join(runDir, "user_intent.md");
    expect(fs.existsSync(intentPath)).toBe(true);
    const intent = fs.readFileSync(intentPath, "utf-8");
    expect(intent).toContain("# User Intent");
    expect(intent).toContain("## Original Human Request (Verbatim)");
    expect(intent).toContain("hello");
    expect(intent).toContain("\"issue\": \"123\"");

    // Check resolved workflow snapshot in artifacts
    const resolvedWorkflowPath = path.join(
      runDir,
      "artifacts",
      "workflow.resolved.yml",
    );
    expect(fs.existsSync(resolvedWorkflowPath)).toBe(true);
    const resolvedWorkflow = yaml.load(
      fs.readFileSync(resolvedWorkflowPath, "utf-8"),
    ) as Record<string, unknown>;
    const steps = (resolvedWorkflow.steps ?? []) as Array<Record<string, unknown>>;
    expect(steps[0].prompt).toBe("Fix issue 123");
    expect(steps[1].prompt).toBe(`Reply via ${triggerPath}`);
    expect(steps[2].prompt).toBe(
      `Store output in ${path.join(runDir, "artifacts", "plan.md")}`,
    );

    // Check initial TODO snapshot exists at run init.
    const todoPath = path.join(runDir, "artifacts", "TODO.md");
    expect(fs.existsSync(todoPath)).toBe(true);
    const todo = fs.readFileSync(todoPath, "utf-8");
    expect(todo).toContain(`Reply via ${triggerPath}`);
    expect(todo).toContain(`Store output in ${path.join(runDir, "artifacts", "plan.md")}`);
    expect(
      fs.readFileSync(
        worktreeMetadataPath("my-org--my-repo", result.worktreeId),
        "utf-8",
      ),
    ).toBe("{}\n");
  });

  it("writes expanded nested workflow steps into the resolved snapshot and TODO", async () => {
    const triageResult: RunInitRequest = {
      repoSlug: "my-org--my-repo",
      workflowFile: "nested-outer.yml",
      workflowName: "Nested Outer",
      inputs: {},
    };

    const trigger: Trigger = {
      source: "slack",
      id: "slack-C123-2000.0001",
      groupKeys: ["slack:C123:2000.0001"],
      timestamp: new Date().toISOString(),
      raw_payload: { text: "run nested workflow" },
    };

    const result = await initRun(triageResult, trigger);
    const runDir = path.join(
      TEST_DIR,
      "repos",
      "my-org--my-repo",
      "tasks",
      result.worktreeId,
      "runs",
      result.runId,
    );

    const resolvedWorkflowPath = path.join(runDir, "artifacts", "workflow.resolved.yml");
    const resolvedWorkflow = yaml.load(
      fs.readFileSync(resolvedWorkflowPath, "utf-8"),
    ) as Record<string, unknown>;
    const steps = (resolvedWorkflow.steps ?? []) as Array<Record<string, unknown>>;

    expect(steps).toHaveLength(2);
    expect(steps[1].kind).toBe("prompt");
    expect(steps[1].name).toBe("write-number");
    expect(steps[1].prompt).toBe("Write {The value in ./nested-outer.txt} to ./nested-inner.txt");
    expect(steps[1].condition).toEqual({
      outcome: "success",
      ai_condition: "The value in ./nested-outer.txt is greater than 0.5",
    });

    const todo = fs.readFileSync(path.join(runDir, "artifacts", "TODO.md"), "utf-8");
    expect(todo).toContain("Create ./nested-outer.txt");
    expect(todo).toContain(
      "Only do this if The value in ./nested-outer.txt is greater than 0.5: Write {The value in ./nested-outer.txt} to ./nested-inner.txt. Otherwise, mark this item as skipped and continue.",
    );
  });

  it("resolves worktree metadata values from worktree_metadata.json", async () => {
    const inheritedWorktreeId = "metadata-existing";
    const wtDir = path.join(
      TEST_DIR,
      "repos",
      "my-org--my-repo",
      "tasks",
      inheritedWorktreeId,
    );
    fs.mkdirSync(wtDir, { recursive: true });
    fs.writeFileSync(
      worktreeMetadataPath("my-org--my-repo", inheritedWorktreeId),
      JSON.stringify({ capture_screen_recordings_run_id: "run-123" }, null, 2),
    );

    const triageResult: RunInitRequest = {
      repoSlug: "my-org--my-repo",
      workflowFile: "worktree-metadata.yml",
      workflowName: "Worktree Metadata",
      inputs: {},
      worktreeId: inheritedWorktreeId,
    };

    const trigger: Trigger = {
      source: "slack",
      id: "slack-C123-3000.0001",
      groupKeys: ["slack:C123:3000.0001"],
      timestamp: new Date().toISOString(),
      raw_payload: { text: "resolve metadata" },
    };

    const result = await initRun(triageResult, trigger);
    const runDir = path.join(
      TEST_DIR,
      "repos",
      "my-org--my-repo",
      "tasks",
      result.worktreeId,
      "runs",
      result.runId,
    );
    const resolvedWorkflow = yaml.load(
      fs.readFileSync(path.join(runDir, "artifacts", "workflow.resolved.yml"), "utf-8"),
    ) as Record<string, unknown>;
    const steps = (resolvedWorkflow.steps ?? []) as Array<Record<string, unknown>>;
    expect(steps[0].prompt).toBe(
      `Recording id is run-123 and metadata file is ${worktreeMetadataPath("my-org--my-repo", inheritedWorktreeId)}`,
    );
  });

  it("creates a new run under existing worktree for action: inherit", async () => {
    // First create a worktree directory to inherit from
    const worktreeId = "fix-bug-existing";
    const wtDir = path.join(
      TEST_DIR,
      "repos",
      "my-org--my-repo",
      "tasks",
      worktreeId,
    );
    fs.mkdirSync(wtDir, { recursive: true });

    const triageResult: RunInitRequest = {
      repoSlug: "my-org--my-repo",
      workflowFile: "followup.yml",
      workflowName: "Follow Up",
      inputs: {},
      worktreeId,
    };

    const trigger: Trigger = {
      source: "slack",
      id: "slack-C123-5555",
      groupKeys: ["slack:C123:5555"],
      timestamp: new Date().toISOString(),
      raw_payload: {},
    };

    const result = await initRun(triageResult, trigger);

    expect(result.worktreeId).toBe(worktreeId);
    expect(result.runId).toMatch(/^\d+-follow-up$/);
    expect(result.runId).not.toBe(result.worktreeId);
    expect(syncRepo).not.toHaveBeenCalled();
    expect(createWorktree).not.toHaveBeenCalled();
    expect(rebaseWorktreeOntoDefaultBranch).toHaveBeenCalledWith(
      "my-org--my-repo",
      worktreeId,
      undefined,
    );

    // Check state was written
    const statePath = path.join(
      wtDir,
      "runs",
      result.runId,
      "workflow_state.json",
    );
    expect(fs.existsSync(statePath)).toBe(true);
  });

  it("throws when inherit worktree does not exist", async () => {
    const triageResult: RunInitRequest = {
      repoSlug: "my-org--my-repo",
      workflowFile: "followup.yml",
      workflowName: "Follow Up",
      inputs: {},
      worktreeId: "nonexistent-worktree",
    };

    const trigger: Trigger = {
      source: "slack",
      id: "slack-C123-999",
      groupKeys: ["slack:C123:999"],
      timestamp: new Date().toISOString(),
      raw_payload: {},
    };

    await expect(initRun(triageResult, trigger)).rejects.toThrow(
      "Worktree directory does not exist",
    );
  });

  it("throws when inherit is used without worktreeId", async () => {
    const triageResult: RunInitRequest = {
      repoSlug: "my-org--my-repo",
      workflowFile: "followup.yml",
      workflowName: "Follow Up",
      inputs: {},
    };

    const trigger: Trigger = {
      source: "slack",
      id: "slack-C123-999",
      groupKeys: ["slack:C123:999"],
      timestamp: new Date().toISOString(),
      raw_payload: {},
    };

    await expect(initRun(triageResult, trigger)).rejects.toThrow(
      "no worktreeId was provided",
    );
  });

  it("throws when workflow file does not exist", async () => {
    const triageResult: RunInitRequest = {
      repoSlug: "my-org--my-repo",
      workflowFile: "nonexistent.yml",
      workflowName: "Missing",
      inputs: {},
    };

    const trigger: Trigger = {
      source: "slack",
      id: "slack-C123-999",
      groupKeys: ["slack:C123:999"],
      timestamp: new Date().toISOString(),
      raw_payload: {},
    };

    await expect(initRun(triageResult, trigger)).rejects.toThrow(
      "Workflow file not found",
    );
  });

  it("throws when workflow requires unconfigured integration", async () => {
    // Write a workflow that requires linear
    const workflowsDir = path.join(
      TEST_DIR,
      "repos",
      "my-org--my-repo",
      "main_repo",
      ".zombieben",
      "workflows",
    );
    fs.writeFileSync(
      path.join(workflowsDir, "needs-linear.yml"),
      `name: Needs Linear\nsteps:\n  - name: fetch\n    prompt: Fetch issues\n    required_integrations:\n      linear:\n`,
    );

    const triageResult: RunInitRequest = {
      repoSlug: "my-org--my-repo",
      workflowFile: "needs-linear.yml",
      workflowName: "Needs Linear",
      inputs: {},
    };

    const trigger: Trigger = {
      source: "slack",
      id: "slack-C123-9999",
      groupKeys: ["slack:C123:9999"],
      timestamp: new Date().toISOString(),
      raw_payload: {},
    };

    await expect(initRun(triageResult, trigger)).rejects.toThrow(
      /requires integration "linear"/,
    );
  });

  it("proceeds when required integrations are configured", async () => {
    const workflowsDir = path.join(
      TEST_DIR,
      "repos",
      "my-org--my-repo",
      "main_repo",
      ".zombieben",
      "workflows",
    );
    fs.writeFileSync(
      path.join(workflowsDir, "needs-linear.yml"),
      `name: Needs Linear\nsteps:\n  - name: fetch\n    prompt: Fetch issues\n    required_integrations:\n      linear:\n`,
    );

    // Configure linear keys
    fs.writeFileSync(
      path.join(TEST_DIR, "keys.json"),
      JSON.stringify({ linear: { api_key: "test-key" } }),
    );

    const triageResult: RunInitRequest = {
      repoSlug: "my-org--my-repo",
      workflowFile: "needs-linear.yml",
      workflowName: "Needs Linear",
      inputs: {},
    };

    const trigger: Trigger = {
      source: "slack",
      id: "slack-C123-8888",
      groupKeys: ["slack:C123:8888"],
      timestamp: new Date().toISOString(),
      raw_payload: {},
    };

    const result = await initRun(triageResult, trigger);
    expect(result.repoSlug).toBe("my-org--my-repo");
  });

  it("captures user intent from GitHub-style title/body fields", async () => {
    const triageResult: RunInitRequest = {
      repoSlug: "my-org--my-repo",
      workflowFile: "fix-bug.yml",
      workflowName: "Fix Bug",
      inputs: { issue: "456" },
    };

    const trigger: Trigger = {
      source: "github",
      id: "github-evt-1",
      groupKeys: ["github:org/repo:1"],
      timestamp: new Date().toISOString(),
      raw_payload: {
        issue: {
          title: "Fix flaky test",
          body: "Please stabilize the integration test.",
        },
      },
    };

    const result = await initRun(triageResult, trigger);
    const intentPath = path.join(
      TEST_DIR,
      "repos",
      "my-org--my-repo",
      "tasks",
      result.worktreeId,
      "runs",
      result.runId,
      "user_intent.md",
    );
    const intent = fs.readFileSync(intentPath, "utf-8");
    expect(intent).toContain("Fix flaky test");
    expect(intent).toContain("Please stabilize the integration test.");
  });
});
