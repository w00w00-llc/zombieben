import fs from "node:fs";
import type { WorkflowDef, WorkflowStepDef } from "@/workflow/types/index.js";
import type { WorkflowRunState, WorkflowRunStatus } from "@/runner/workflow-run-state.js";
import type { StepResult, StepRunnerOpts } from "./step-runner.js";
import { executeStep } from "./step-runner.js";
import type { TemplateContext } from "@/workflow/template.js";
import { executeBuiltin } from "./builtins.js";

// --- Pure state machine ---

export type AdvanceAction =
  | "next"
  | "retry"
  | "completed"
  | "failed"
  | "awaiting_approval";

export interface AdvanceResult {
  action: AdvanceAction;
  state: WorkflowRunState;
}

/**
 * Pure state machine: given current state and step result,
 * determine the next state.
 */
export function advanceWorkflow(
  workflow: WorkflowDef,
  state: WorkflowRunState,
  stepResult: StepResult,
): AdvanceResult {
  const currentStep = workflow.steps[state.step_index];

  // Step failed
  if (!stepResult.success) {
    // Has retry policy with remaining attempts (only prompt steps have retry)
    const retryPolicy =
      currentStep.kind === "prompt" ? currentStep.retry_policy : undefined;

    if (retryPolicy && state.attempt < retryPolicy.max_attempts) {
      return {
        action: "retry",
        state: {
          ...state,
          attempt: state.attempt + 1,
          status: "running",
          updated_at: new Date().toISOString(),
        },
      };
    }

    // Failed with no retries left
    return {
      action: "failed",
      state: {
        ...state,
        status: "failed",
        error:
          stepResult.failures?.join("; ") ??
          stepResult.summary ??
          "Step failed",
        updated_at: new Date().toISOString(),
      },
    };
  }

  // Step succeeded — advance to next
  return toNextStep(workflow, state, stepResult);
}

function getStepName(step: WorkflowStepDef, index: number): string {
  if (step.kind === "builtin") return step.uses;
  return step.name || `step-${index}`;
}

function getStepMaxAttempts(step: WorkflowStepDef): number {
  if (step.kind === "prompt" && step.retry_policy) {
    return step.retry_policy.max_attempts;
  }
  return 1;
}

function toNextStep(
  workflow: WorkflowDef,
  state: WorkflowRunState,
  stepResult: StepResult,
): AdvanceResult {
  const nextIndex = state.step_index + 1;

  // Collect artifacts from the step result
  const updatedArtifacts = { ...state.artifacts };
  if (stepResult.artifacts) {
    for (const artifact of stepResult.artifacts) {
      const name =
        artifact
          .split("/")
          .pop()
          ?.replace(/\.[^.]+$/, "") ?? artifact;
      updatedArtifacts[name] = artifact;
    }
  }

  if (nextIndex >= workflow.steps.length) {
    return {
      action: "completed",
      state: {
        ...state,
        status: "completed",
        artifacts: updatedArtifacts,
        pr_url:
          stepResult.artifacts?.find((a) => a.includes("pull-request")) ??
          state.pr_url,
        updated_at: new Date().toISOString(),
      },
    };
  }

  const nextStep = workflow.steps[nextIndex];

  // Check for approval gate (only prompt steps)
  const nextStatus: WorkflowRunStatus = shouldAwaitApproval(nextStep)
    ? "awaiting_approval"
    : "running";

  return {
    action: nextStatus === "awaiting_approval" ? "awaiting_approval" : "next",
    state: {
      ...state,
      step_index: nextIndex,
      step_name: getStepName(nextStep, nextIndex),
      attempt: 1,
      max_attempts: getStepMaxAttempts(nextStep),
      status: nextStatus,
      artifacts: updatedArtifacts,
      updated_at: new Date().toISOString(),
    },
  };
}

function shouldAwaitApproval(step: WorkflowStepDef): boolean {
  if (step.kind !== "prompt") return false;
  if (!step.await_approval) return false;
  const enabled = step.await_approval.enabled;
  return enabled === true || enabled === "true";
}

// --- Initialization ---

export function initWorkflowRunState(
  workflow: WorkflowDef,
  workflowFile: string,
  inputs: Record<string, unknown>,
): WorkflowRunState {
  const firstStep = workflow.steps[0];
  const now = new Date().toISOString();

  return {
    workflow_name: workflow.name,
    workflow_file: workflowFile,
    status: "running",
    step_index: 0,
    step_name: getStepName(firstStep, 0),
    attempt: 1,
    max_attempts: getStepMaxAttempts(firstStep),
    inputs,
    artifacts: {},
    created_at: now,
    updated_at: now,
  };
}

// --- I/O execution loop ---

export interface RunWorkflowOpts extends StepRunnerOpts {
  statePath: string;
  onStateChange?: (state: WorkflowRunState) => void;
}

/**
 * Full I/O execution loop: run through workflow steps sequentially.
 */
export async function runWorkflow(
  workflow: WorkflowDef,
  state: WorkflowRunState,
  context: TemplateContext,
  opts: RunWorkflowOpts,
): Promise<WorkflowRunState> {
  let currentState = state;

  while (currentState.status === "running") {
    const step = workflow.steps[currentState.step_index];

    // Check conditional execution (prompt, for, and script steps have `if`)
    const stepIf = step.kind !== "builtin" ? step.if : undefined;
    if (stepIf) {
      const shouldRun = evaluateCondition(stepIf, currentState);
      if (!shouldRun) {
        const skipResult: StepResult = {
          success: true,
          summary: "Skipped (condition not met)",
        };
        const { state: nextState } = advanceWorkflow(
          workflow,
          currentState,
          skipResult,
        );
        currentState = nextState;
        persistState(currentState, opts.statePath);
        opts.onStateChange?.(currentState);
        continue;
      }
    }

    let result: StepResult;

    if (step.kind === "builtin") {
      result = await executeBuiltin(step, context);
    } else {
      result = await executeStep(step, context, opts);
    }

    const { state: nextState } = advanceWorkflow(
      workflow,
      currentState,
      result,
    );
    currentState = nextState;
    persistState(currentState, opts.statePath);
    opts.onStateChange?.(currentState);
  }

  return currentState;
}

function evaluateCondition(
  condition: "success" | "failure" | "always",
  state: WorkflowRunState,
): boolean {
  switch (condition) {
    case "always":
      return true;
    case "success":
      return state.status !== "failed";
    case "failure":
      return state.status === "failed";
  }
}

function persistState(state: WorkflowRunState, statePath: string): void {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}
