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

describe("initRun", () => {
  beforeEach(() => {
    process.env.ZOMBIEBEN_RUNNER_DIR = TEST_DIR;
    fs.mkdirSync(TEST_DIR, { recursive: true });

    // Create a mock workflow file
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
  });

  afterEach(() => {
    delete process.env.ZOMBIEBEN_RUNNER_DIR;
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("creates directory structure with workflow_state.json and trigger.json", () => {
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

    initRun(triageResult, trigger);

    // Find the created worktree dir
    const tasksDir = path.join(TEST_DIR, "repos", "my-org--my-repo", "tasks");
    expect(fs.existsSync(tasksDir)).toBe(true);
    const entries = fs.readdirSync(tasksDir);
    expect(entries.length).toBe(1);
    expect(entries[0]).toMatch(/^fix-bug-\d+$/);

    const wtDir = path.join(tasksDir, entries[0]);

    // Check workflow_state.json
    const statePath = path.join(wtDir, "workflow_state.json");
    expect(fs.existsSync(statePath)).toBe(true);
    const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    expect(state.workflow_name).toBe("Fix Bug");
    expect(state.workflow_file).toBe("fix-bug.yml");
    expect(state.status).toBe("running");
    expect(state.inputs).toEqual({ issue: "123" });

    // Check trigger.json
    const triggerPath = path.join(wtDir, "trigger.json");
    expect(fs.existsSync(triggerPath)).toBe(true);
    const triggerData = JSON.parse(fs.readFileSync(triggerPath, "utf-8"));
    expect(triggerData.id).toBe("slack-C123-1234.5678");
    expect(triggerData.source).toBe("slack");
  });

  it("throws when workflow file does not exist", () => {
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

    expect(() => initRun(triageResult, trigger)).toThrow(
      "Workflow file not found",
    );
  });
});
