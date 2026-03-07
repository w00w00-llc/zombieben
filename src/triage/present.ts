import type {
  TriageOutcome,
} from "./types.js";

export interface PresentResult {
  shouldRun: boolean;
  resolution?: {
    repoSlug: string;
    workflowFile: string;
    workflowName: string;
    inputs: Record<string, string>;
    worktreeId?: string;
  };
  retryResolution?: {
    repoSlug: string;
    worktreeId: string;
    runId: string;
    inputsOverride?: Record<string, string>;
  };
}

function extractResolution(run: {
  repoSlug: string;
  workflowFile: string;
  workflowName: string;
  inputs: Record<string, string>;
  worktreeId?: string;
}): PresentResult["resolution"] {
  return {
    repoSlug: run.repoSlug,
    workflowFile: run.workflowFile,
    workflowName: run.workflowName,
    inputs: run.inputs,
    ...(run.worktreeId ? { worktreeId: run.worktreeId } : {}),
  };
}

export function presentOutcome(outcome: TriageOutcome): PresentResult {
  switch (outcome.kind) {
    case "immediate_response":
      return { shouldRun: false };

    case "new_workflow":
      return presentNewWorkflow(outcome);

    case "in_progress_workflow_adjustment":
      if (outcome.action.type === "retry_fresh") {
        return {
          shouldRun: true,
          retryResolution: {
            repoSlug: outcome.relatedRun.repoSlug,
            worktreeId: outcome.relatedRun.worktreeId,
            runId: outcome.relatedRun.runId,
            inputsOverride: outcome.action.inputsOverride,
          },
        };
      }
      return { shouldRun: false };
  }
}

function presentNewWorkflow(outcome: Extract<TriageOutcome, { kind: "new_workflow" }>): PresentResult {
  const { resolution } = outcome;

  switch (resolution.type) {
    case "run":
      return { shouldRun: true, resolution: extractResolution(resolution) };

    case "confirm":
      return { shouldRun: false };

    case "suggest":
      return { shouldRun: false };
  }
}
