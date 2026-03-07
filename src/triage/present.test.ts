import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TriggerResponder } from "@/responder/responder.js";
import type { TriageOutcome } from "./types.js";
import { presentOutcome, type PresentResult } from "./present.js";

function mockResponder(): TriggerResponder {
  return {
    send: vi.fn().mockResolvedValue({ id: "msg-1" }),
    edit: vi.fn().mockResolvedValue(undefined),
    react: vi.fn().mockResolvedValue(undefined),
    unreact: vi.fn().mockResolvedValue(undefined),
    promptChoice: vi.fn().mockResolvedValue(0),
    waitForReply: vi.fn().mockResolvedValue(""),
  };
}

describe("presentOutcome", () => {
  let responder: ReturnType<typeof mockResponder>;

  beforeEach(() => {
    responder = mockResponder();
  });

  // --- immediate_response ---

  it("sends message as-is for immediate_response", async () => {
    const outcome: TriageOutcome = {
      kind: "immediate_response",
      message: "Hello there!",
      reasoning: "greeting",
    };

    const result = await presentOutcome(outcome, responder);

    expect(responder.send).toHaveBeenCalledWith("Hello there!");
    expect(result.shouldRun).toBe(false);
  });

  // --- new_workflow: run ---

  it("sends run message for new_workflow run", async () => {
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

    const result = await presentOutcome(outcome, responder);

    expect(responder.send).toHaveBeenCalledWith(
      "Running *Implement Feature* (`implement.yml`) in `my-org/my-repo`\n> *task_id:* TASK-1",
    );
    expect(responder.promptChoice).not.toHaveBeenCalled();
    expect(result.shouldRun).toBe(true);
    expect(result.resolution).toEqual({
      repoSlug: "my-org/my-repo",
      workflowFile: "implement.yml",
      workflowName: "Implement Feature",
      inputs: { task_id: "TASK-1" },
    });
  });

  // --- new_workflow: confirm ---

  it("sends run message when user confirms", async () => {
    vi.mocked(responder.promptChoice).mockResolvedValue(0);

    const outcome: TriageOutcome = {
      kind: "new_workflow",
      resolution: {
        type: "confirm",
        repoSlug: "my-org/my-repo",
        workflowFile: "deploy.yml",
        workflowName: "Deploy to Prod",
        inputs: {},
        confirmationPrompt: "Deploy to production?",
      },
      reasoning: "needs confirm",
    };

    const result = await presentOutcome(outcome, responder);

    expect(responder.promptChoice).toHaveBeenCalledWith(
      "Deploy to production?",
      ["Yes, run it", "No, cancel"],
    );
    expect(responder.send).toHaveBeenCalledWith(
      "Running *Deploy to Prod* (`deploy.yml`) in `my-org/my-repo`",
    );
    expect(result.shouldRun).toBe(true);
    expect(result.resolution).toEqual({
      repoSlug: "my-org/my-repo",
      workflowFile: "deploy.yml",
      workflowName: "Deploy to Prod",
      inputs: {},
    });
  });

  it("sends cancelled message when user declines", async () => {
    vi.mocked(responder.promptChoice).mockResolvedValue(1);

    const outcome: TriageOutcome = {
      kind: "new_workflow",
      resolution: {
        type: "confirm",
        repoSlug: "my-org/my-repo",
        workflowFile: "deploy.yml",
        workflowName: "Deploy to Prod",
        inputs: {},
        confirmationPrompt: "Deploy to production?",
      },
      reasoning: "needs confirm",
    };

    const result = await presentOutcome(outcome, responder);

    expect(responder.send).toHaveBeenCalledWith("Cancelled.");
    expect(result.shouldRun).toBe(false);
  });

  // --- new_workflow: suggest ---

  it("prompts with workflow names and sends run message for selection", async () => {
    vi.mocked(responder.promptChoice).mockResolvedValue(1);

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
          {
            repoSlug: "org/repo-b",
            workflowFile: "test.yml",
            workflowName: "Run Tests",
            inputs: {},
            description: "Runs all tests",
          },
        ],
        prompt: "Which workflow?",
      },
      reasoning: "ambiguous",
    };

    const result = await presentOutcome(outcome, responder);

    expect(responder.promptChoice).toHaveBeenCalledWith("Which workflow?", [
      "Build",
      "Run Tests",
    ]);
    expect(responder.send).toHaveBeenCalledWith(
      "Running *Run Tests* (`test.yml`) in `org/repo-b`",
    );
    expect(result.shouldRun).toBe(true);
    expect(result.resolution).toEqual({
      repoSlug: "org/repo-b",
      workflowFile: "test.yml",
      workflowName: "Run Tests",
      inputs: {},
    });
  });

  // --- in_progress_workflow_adjustment ---

  it("sends status_check message", async () => {
    const outcome: TriageOutcome = {
      kind: "in_progress_workflow_adjustment",
      relatedRun: { repoSlug: "org/repo", worktreeId: "wt-123", runId: "wt-123" },
      action: { type: "status_check" },
      reasoning: "user asked",
    };

    const result = await presentOutcome(outcome, responder);

    expect(responder.send).toHaveBeenCalledWith(
      "Checking status of *wt-123* in `org/repo`...",
    );
    expect(result.shouldRun).toBe(false);
  });

  it("sends pause message", async () => {
    const outcome: TriageOutcome = {
      kind: "in_progress_workflow_adjustment",
      relatedRun: { repoSlug: "org/repo", worktreeId: "wt-123", runId: "wt-123" },
      action: { type: "pause" },
      reasoning: "user asked",
    };

    const result = await presentOutcome(outcome, responder);

    expect(responder.send).toHaveBeenCalledWith(
      "Pausing *wt-123* in `org/repo`.",
    );
    expect(result.shouldRun).toBe(false);
  });

  it("sends resume message", async () => {
    const outcome: TriageOutcome = {
      kind: "in_progress_workflow_adjustment",
      relatedRun: { repoSlug: "org/repo", worktreeId: "wt-123", runId: "wt-123" },
      action: { type: "resume" },
      reasoning: "user asked",
    };

    const result = await presentOutcome(outcome, responder);

    expect(responder.send).toHaveBeenCalledWith(
      "Resuming *wt-123* in `org/repo`.",
    );
    expect(result.shouldRun).toBe(false);
  });

  it("sends cancel message", async () => {
    const outcome: TriageOutcome = {
      kind: "in_progress_workflow_adjustment",
      relatedRun: { repoSlug: "org/repo", worktreeId: "wt-123", runId: "wt-123" },
      action: { type: "cancel" },
      reasoning: "user asked",
    };

    const result = await presentOutcome(outcome, responder);

    expect(responder.send).toHaveBeenCalledWith(
      "Cancelling *wt-123* in `org/repo`.",
    );
    expect(result.shouldRun).toBe(false);
  });

  it("sends adjust message with instruction", async () => {
    const outcome: TriageOutcome = {
      kind: "in_progress_workflow_adjustment",
      relatedRun: { repoSlug: "org/repo", worktreeId: "wt-123", runId: "wt-123" },
      action: { type: "adjust", instruction: "Make it less red" },
      reasoning: "user asked",
    };

    const result = await presentOutcome(outcome, responder);

    expect(responder.send).toHaveBeenCalledWith(
      "Adjusting *wt-123* in `org/repo`: Make it less red",
    );
    expect(result.shouldRun).toBe(false);
  });

  it("sends rollback_to_step message", async () => {
    const outcome: TriageOutcome = {
      kind: "in_progress_workflow_adjustment",
      relatedRun: { repoSlug: "org/repo", worktreeId: "wt-123", runId: "wt-123" },
      action: { type: "rollback_to_step", stepIndex: 3 },
      reasoning: "user asked",
    };

    const result = await presentOutcome(outcome, responder);

    expect(responder.send).toHaveBeenCalledWith(
      "Rolling back *wt-123* in `org/repo` to step 3.",
    );
    expect(result.shouldRun).toBe(false);
  });
});
