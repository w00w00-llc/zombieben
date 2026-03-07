import { describe, it, expect } from "vitest";
import type { TriageOutcome } from "./types.js";
import { presentOutcome } from "./present.js";

describe("presentOutcome", () => {
  it("returns shouldRun false for immediate_response", () => {
    const outcome: TriageOutcome = {
      kind: "immediate_response",
      message: "Hello there!",
      reasoning: "greeting",
    };

    const result = presentOutcome(outcome);
    expect(result.shouldRun).toBe(false);
  });

  it("returns shouldRun true + resolution for new_workflow run", () => {
    const outcome: TriageOutcome = {
      kind: "new_workflow",
      resolution: {
        type: "run",
        repoSlug: "my-org/my-repo",
        workflowFile: "implement.yml",
        workflowName: "Implement Feature",
        inputs: { task_id: "TASK-1" },
      },
      reasoning: "matched",
    };

    const result = presentOutcome(outcome);
    expect(result.shouldRun).toBe(true);
    expect(result.resolution).toEqual({
      repoSlug: "my-org/my-repo",
      workflowFile: "implement.yml",
      workflowName: "Implement Feature",
      inputs: { task_id: "TASK-1" },
    });
  });

  it("returns shouldRun false for new_workflow confirm", () => {
    const outcome: TriageOutcome = {
      kind: "new_workflow",
      resolution: {
        type: "confirm",
        repoSlug: "my-org/my-repo",
        workflowFile: "deploy.yml",
        workflowName: "Deploy to Prod",
        inputs: {},
      },
      reasoning: "needs confirm",
    };

    const result = presentOutcome(outcome);
    expect(result.shouldRun).toBe(false);
  });

  it("returns shouldRun false for new_workflow suggest", () => {
    const outcome: TriageOutcome = {
      kind: "new_workflow",
      resolution: {
        type: "suggest",
        suggestions: [
          {
            repoSlug: "org/repo-a",
            workflowFile: "build.yml",
            workflowName: "Build",
            inputs: {},
            description: "Builds the project",
          },
        ],
        prompt: "Which workflow?",
      },
      reasoning: "ambiguous",
    };

    const result = presentOutcome(outcome);
    expect(result.shouldRun).toBe(false);
  });

  it("returns shouldRun false for status_check", () => {
    const outcome: TriageOutcome = {
      kind: "in_progress_workflow_adjustment",
      relatedRun: { repoSlug: "org/repo", worktreeId: "wt-123", runId: "wt-123" },
      action: { type: "status_check" },
      reasoning: "user asked",
    };

    const result = presentOutcome(outcome);
    expect(result.shouldRun).toBe(false);
  });

  it("returns shouldRun false for pause", () => {
    const outcome: TriageOutcome = {
      kind: "in_progress_workflow_adjustment",
      relatedRun: { repoSlug: "org/repo", worktreeId: "wt-123", runId: "wt-123" },
      action: { type: "pause" },
      reasoning: "user paused",
    };

    const result = presentOutcome(outcome);
    expect(result.shouldRun).toBe(false);
  });

  it("returns shouldRun false for resume", () => {
    const outcome: TriageOutcome = {
      kind: "in_progress_workflow_adjustment",
      relatedRun: { repoSlug: "org/repo", worktreeId: "wt-123", runId: "wt-123" },
      action: { type: "resume" },
      reasoning: "user asked",
    };

    const result = presentOutcome(outcome);
    expect(result.shouldRun).toBe(false);
  });

  it("returns shouldRun false for cancel", () => {
    const outcome: TriageOutcome = {
      kind: "in_progress_workflow_adjustment",
      relatedRun: { repoSlug: "org/repo", worktreeId: "wt-123", runId: "wt-123" },
      action: { type: "cancel" },
      reasoning: "user asked",
    };

    const result = presentOutcome(outcome);
    expect(result.shouldRun).toBe(false);
  });

  it("returns shouldRun false for adjust", () => {
    const outcome: TriageOutcome = {
      kind: "in_progress_workflow_adjustment",
      relatedRun: { repoSlug: "org/repo", worktreeId: "wt-123", runId: "wt-123" },
      action: { type: "adjust", instruction: "Make it less red" },
      reasoning: "user asked",
    };

    const result = presentOutcome(outcome);
    expect(result.shouldRun).toBe(false);
  });

  it("returns shouldRun false for rollback_to_step", () => {
    const outcome: TriageOutcome = {
      kind: "in_progress_workflow_adjustment",
      relatedRun: { repoSlug: "org/repo", worktreeId: "wt-123", runId: "wt-123" },
      action: { type: "rollback_to_step", stepIndex: 3 },
      reasoning: "user asked",
    };

    const result = presentOutcome(outcome);
    expect(result.shouldRun).toBe(false);
  });

  it("returns retryResolution for retry_fresh", () => {
    const outcome: TriageOutcome = {
      kind: "in_progress_workflow_adjustment",
      relatedRun: { repoSlug: "org/repo", worktreeId: "wt-123", runId: "run-123" },
      action: { type: "retry_fresh", inputsOverride: { issue: "456" } },
      reasoning: "user asked to retry",
    };

    const result = presentOutcome(outcome);
    expect(result.shouldRun).toBe(true);
    expect(result.retryResolution).toEqual({
      repoSlug: "org/repo",
      worktreeId: "wt-123",
      runId: "run-123",
      inputsOverride: { issue: "456" },
    });
  });
});
