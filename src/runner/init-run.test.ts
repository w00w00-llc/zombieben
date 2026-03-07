import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initRun } from "./init-run.js";
import type { TriageResult } from "./init-run.js";
import type { Trigger } from "@/ingestor/trigger.js";

const TEST_DIR = path.join(os.tmpdir(), "zombieben-init-run-test");

vi.mock("../util/logger.js", () => ({
  log: { info: vi.fn(), error: vi.fn() },
}));

vi.mock("../engine/worktree.js", () => ({
  createWorktree: vi.fn().mockResolvedValue("/mock/worktree/path"),
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
      `name: Fix Bug\nsteps:\n  - name: do-it\n    prompt: Fix the bug\n`,
    );
    fs.writeFileSync(
      path.join(workflowsDir, "followup.yml"),
      `name: Follow Up\nworktree:\n  action: inherit\n  parents:\n    - fix-bug\nsteps:\n  - name: check\n    prompt: Check the fix\n`,
    );
  });

  afterEach(() => {
    delete process.env.ZOMBIEBEN_RUNNER_DIR;
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("creates directory structure with runs/{runId}/workflow_state.json and trigger.json", async () => {
    const triageResult: TriageResult = {
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
      raw_payload: {},
    };

    const result = await initRun(triageResult, trigger);

    expect(result.repoSlug).toBe("my-org--my-repo");
    expect(result.worktreeId).toMatch(/^fix-bug-\d+$/);
    expect(result.runId).toBe(result.worktreeId); // For "create", runId === worktreeId

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
    expect(triggerData.id).toBe("slack-C123-1234.5678");
    expect(triggerData.source).toBe("slack");
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

    const triageResult: TriageResult = {
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
    expect(result.runId).toMatch(/^follow-up-\d+$/);
    expect(result.runId).not.toBe(result.worktreeId);

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
    const triageResult: TriageResult = {
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
    const triageResult: TriageResult = {
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
    const triageResult: TriageResult = {
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
      `name: Needs Linear\nsteps:\n  - name: fetch\n    prompt: Fetch issues\n    required_integrations:\n      - linear:\n`,
    );

    const triageResult: TriageResult = {
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
      `name: Needs Linear\nsteps:\n  - name: fetch\n    prompt: Fetch issues\n    required_integrations:\n      - linear:\n`,
    );

    // Configure linear keys
    fs.writeFileSync(
      path.join(TEST_DIR, "keys.json"),
      JSON.stringify({ linear: { api_key: "test-key" } }),
    );

    const triageResult: TriageResult = {
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
});
