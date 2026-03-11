import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRunState } from "@/engine/workflow-run-state.js";
import {
  repoWorkflowsDir,
  runArtifactsDir,
  runStatePath,
  worktreeRepoDir,
} from "@/util/paths.js";
import type { ActiveRun } from "./scanner.js";

const scanActiveRunsMock = vi.fn<() => ActiveRun[]>(() => []);
const executeWorkflowSliceMock = vi.fn();
const advanceWorkflowMock = vi.fn();
const sendRunMessageMock = vi.fn();
const createLoggerMock = vi.fn(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("./scanner.js", () => ({
  scanActiveRuns: scanActiveRunsMock,
}));

vi.mock("@/engine/workflow-runner.js", () => ({
  executeWorkflowSlice: executeWorkflowSliceMock,
  advanceWorkflow: advanceWorkflowMock,
}));

vi.mock("./runtime-workflow.js", () => ({
  prepareWorkflowForRun: vi.fn((_repoSlug: string, workflow: unknown) => workflow),
}));

vi.mock("./run-notify.js", () => ({
  sendRunMessage: sendRunMessageMock,
}));

vi.mock("@/util/logger.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  createLogger: createLoggerMock,
}));

describe("processTick awaiting approval", () => {
  const originalRunnerDir = process.env.ZOMBIEBEN_RUNNER_DIR;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ZOMBIEBEN_RUNNER_DIR = fs.mkdtempSync(
      path.join(os.tmpdir(), "zombieben-tick-"),
    );
  });

  afterEach(() => {
    if (originalRunnerDir == null) {
      delete process.env.ZOMBIEBEN_RUNNER_DIR;
    } else {
      process.env.ZOMBIEBEN_RUNNER_DIR = originalRunnerDir;
    }
  });

  it("sends one approval request with all resolved attachments", async () => {
    const repoSlug = "org--repo";
    const worktreeId = "wt-1";
    const runId = "run-1";
    const workflowFile = "approval.yml";

    const workflowsDir = repoWorkflowsDir(repoSlug);
    fs.mkdirSync(workflowsDir, { recursive: true });
    fs.writeFileSync(
      path.join(workflowsDir, workflowFile),
      [
        "name: Approval Workflow",
        "steps:",
        "  - name: Draft Plan",
        "    prompt: Draft the plan",
        "  - name: Await Approval",
        "    prompt: Wait for approval",
        "    await_approval:",
        "      enabled: true",
        "      attachments:",
        "        - ${{ artifacts.plan }}",
        "        - docs/notes.md",
      ].join("\n"),
    );

    const repoDir = worktreeRepoDir(repoSlug, worktreeId);
    fs.mkdirSync(path.join(repoDir, "docs"), { recursive: true });
    const notesPath = path.join(repoDir, "docs", "notes.md");
    fs.writeFileSync(notesPath, "notes");

    const artifactsDir = runArtifactsDir(repoSlug, worktreeId, runId);
    fs.mkdirSync(artifactsDir, { recursive: true });
    const planPath = path.join(artifactsDir, "plan.md");
    fs.writeFileSync(planPath, "plan");

    const statePath = runStatePath(repoSlug, worktreeId, runId);
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const state: WorkflowRunState = {
      workflow_name: "Approval Workflow",
      workflow_file: workflowFile,
      status: "running",
      step_index: 0,
      step_name: "Draft Plan",
      attempt: 1,
      max_attempts: 1,
      inputs: {},
      artifacts: {},
      created_at: "2026-03-10T00:00:00.000Z",
      updated_at: "2026-03-10T00:00:00.000Z",
    };
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

    scanActiveRunsMock.mockReturnValue([
      {
        repoSlug,
        worktreeId,
        runId,
        state,
        statePath,
      },
    ]);
    executeWorkflowSliceMock.mockResolvedValue({ success: true, summary: "ok" });
    advanceWorkflowMock.mockReturnValue({
      action: "awaiting_approval",
      state: {
        ...state,
        status: "awaiting_approval",
        step_index: 1,
        step_name: "Await Approval",
        updated_at: "2026-03-10T00:00:01.000Z",
      },
    });

    const { processTick, setAgent } = await import("./tick.js");
    setAgent({} as never);
    await processTick();

    expect(sendRunMessageMock).toHaveBeenCalledWith(
      { repoSlug, worktreeId, runId },
      expect.stringContaining('Awaiting approval for step "Await Approval".'),
      undefined,
      {
        attachments: [planPath, notesPath],
      },
    );
  });
});
