import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { applyOutcome, markRunSuperseded } from "./apply.js";
import type { TriageOutcome } from "./types.js";
import type { WorkflowRunState } from "@/engine/workflow-run-state.js";

const TEST_DIR = path.join(os.tmpdir(), "zombieben-apply-test");

vi.mock("../util/logger.js", () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

function writeState(
  repoSlug: string,
  worktreeId: string,
  runId: string,
  state: WorkflowRunState,
): string {
  const runDir = path.join(
    TEST_DIR,
    "repos",
    repoSlug,
    "tasks",
    worktreeId,
    "runs",
    runId,
  );
  fs.mkdirSync(runDir, { recursive: true });
  const statePath = path.join(runDir, "workflow_state.json");
  fs.writeFileSync(statePath, JSON.stringify(state));
  return statePath;
}

function readState(statePath: string): WorkflowRunState {
  return JSON.parse(fs.readFileSync(statePath, "utf-8")) as WorkflowRunState;
}

function makeState(overrides: Partial<WorkflowRunState> = {}): WorkflowRunState {
  return {
    workflow_name: "Test",
    workflow_file: "test.yml",
    status: "running",
    step_index: 1,
    step_name: "step-1",
    attempt: 1,
    max_attempts: 1,
    inputs: {},
    artifacts: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("applyOutcome", () => {
  beforeEach(() => {
    process.env.ZOMBIEBEN_RUNNER_DIR = TEST_DIR;
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    delete process.env.ZOMBIEBEN_RUNNER_DIR;
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("resumes an awaiting_approval run by setting status to running", () => {
    const statePath = writeState(
      "org--repo",
      "wt-1",
      "run-1",
      makeState({ status: "awaiting_approval" }),
    );

    const outcome: TriageOutcome = {
      kind: "in_progress_workflow_adjustment",
      relatedRun: { repoSlug: "org--repo", worktreeId: "wt-1", runId: "run-1" },
      action: { type: "resume" },
      reasoning: "user approved",
    };

    applyOutcome(outcome);

    const state = readState(statePath);
    expect(state.status).toBe("running");
  });

  it("does not resume a run that is not awaiting_approval", () => {
    const statePath = writeState(
      "org--repo",
      "wt-1",
      "run-1",
      makeState({ status: "running" }),
    );

    const outcome: TriageOutcome = {
      kind: "in_progress_workflow_adjustment",
      relatedRun: { repoSlug: "org--repo", worktreeId: "wt-1", runId: "run-1" },
      action: { type: "resume" },
      reasoning: "user said go",
    };

    applyOutcome(outcome);

    const state = readState(statePath);
    expect(state.status).toBe("running"); // unchanged
  });

  it("cancels a run by setting status to failed", () => {
    const statePath = writeState(
      "org--repo",
      "wt-1",
      "run-1",
      makeState({ status: "running" }),
    );

    const outcome: TriageOutcome = {
      kind: "in_progress_workflow_adjustment",
      relatedRun: { repoSlug: "org--repo", worktreeId: "wt-1", runId: "run-1" },
      action: { type: "cancel" },
      reasoning: "user cancelled",
    };

    applyOutcome(outcome);

    const state = readState(statePath);
    expect(state.status).toBe("failed");
    expect(state.error).toBe("Cancelled by user");
  });

  it("pauses a running run by setting status to awaiting_approval", () => {
    const statePath = writeState(
      "org--repo",
      "wt-1",
      "run-1",
      makeState({ status: "running" }),
    );

    const outcome: TriageOutcome = {
      kind: "in_progress_workflow_adjustment",
      relatedRun: { repoSlug: "org--repo", worktreeId: "wt-1", runId: "run-1" },
      action: { type: "pause" },
      reasoning: "user paused",
    };

    applyOutcome(outcome);

    const state = readState(statePath);
    expect(state.status).toBe("awaiting_approval");
  });

  it("is a no-op for non-adjustment outcomes", () => {
    const outcome: TriageOutcome = {
      kind: "immediate_response",
      message: "hello",
      reasoning: "greeting",
    };

    // Should not throw
    applyOutcome(outcome);
  });

  it("is a no-op for retry_fresh action", () => {
    const statePath = writeState(
      "org--repo",
      "wt-1",
      "run-1",
      makeState({ status: "failed" }),
    );

    const outcome: TriageOutcome = {
      kind: "in_progress_workflow_adjustment",
      relatedRun: { repoSlug: "org--repo", worktreeId: "wt-1", runId: "run-1" },
      action: { type: "retry_fresh" },
      reasoning: "retry from scratch",
    };

    applyOutcome(outcome);

    const state = readState(statePath);
    expect(state.status).toBe("failed");
  });

  it("marks run as superseded", () => {
    const statePath = writeState(
      "org--repo",
      "wt-1",
      "run-1",
      makeState({ status: "failed" }),
    );

    markRunSuperseded(
      { repoSlug: "org--repo", worktreeId: "wt-1", runId: "run-1" },
      { repoSlug: "org--repo", worktreeId: "wt-2", runId: "run-2" },
    );

    const state = readState(statePath);
    expect(state.status).toBe("superseded");
    expect(state.superseded_by).toEqual({
      repoSlug: "org--repo",
      worktreeId: "wt-2",
      runId: "run-2",
    });
  });
});
