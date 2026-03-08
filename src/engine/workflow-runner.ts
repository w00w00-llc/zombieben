import { execFile as execFileCb } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { WorkflowDef, WorkflowStepDef } from "./workflow-types.js";
import type {
  WorkflowRunState,
  WorkflowRunStatus,
} from "./workflow-run-state.js";
import type { TemplateContext } from "./workflow-template.js";
import type { Logger } from "@/util/logger.js";
import { shouldAwaitApprovalForPrompt } from "./await-approval.js";
import type { ScriptStepDef } from "./workflow-types.js";
import { createTodoMarkdown } from "./todo-generator.js";
import { EXECUTE_TODOS_SYSTEM_PROMPT } from "./execute-todos-prompt.js";
import type { CodingAgent } from "@/codingagents/index.js";
import { resolveIntegrationsForStep } from "./integration-resolver.js";

const execFile = promisify(execFileCb);

export interface StepResult {
  success: boolean;
  summary?: string;
  failures?: string[];
  artifacts?: string[];
  todoFullyComplete?: boolean;
  intentAligned?: boolean;
}

export interface StepRunnerOpts {
  agent: CodingAgent;
  workingDir: string;
  artifactsDir: string;
  dryRun?: boolean;
  log?: Logger;
}

export async function executeScriptStep(
  step: ScriptStepDef,
  opts: StepRunnerOpts
): Promise<StepResult> {
  if (opts.dryRun) {
    return { success: true, summary: "Dry run — skipped execution" };
  }

  try {
    const { stdout } = await execFile("sh", ["-c", step.runs], {
      cwd: opts.workingDir,
      maxBuffer: 50 * 1024 * 1024,
    });
    return { success: true, summary: stdout.trim() || "Script completed successfully" };
  } catch (err) {
    const error = err as Error & { stdout?: string; stderr?: string };
    return {
      success: false,
      summary: error.stderr?.trim() || error.message,
    };
  }
}

export async function executeWorkflowSlice(
  workflow: WorkflowDef,
  stepIndex: number,
  context: TemplateContext,
  opts: StepRunnerOpts
): Promise<StepResult> {
  const step = workflow.steps[stepIndex];

  if (step.kind === "script") {
    return executeScriptStep(step, opts);
  }

  const todoPath = path.join(opts.artifactsDir, "TODO.md");
  fs.mkdirSync(opts.artifactsDir, { recursive: true });
  if (!fs.existsSync(todoPath)) {
    // Backward compatibility for runs created before initRun started writing TODO.md.
    const todo = createTodoMarkdown(workflow, context, stepIndex);
    fs.writeFileSync(todoPath, todo);
  }

  if (opts.dryRun) {
    return { success: true, summary: "Dry run — skipped execution" };
  }

  const integrations = resolveIntegrationsForStep(step);

  try {
    const stepLogPrefix = `step-${String(stepIndex).padStart(3, "0")}`;
    const runDir = path.resolve(opts.artifactsDir, "..");
    const userIntentPath = path.join(runDir, "user_intent.md");
    const intentReviewPath = path.join(opts.artifactsDir, "intent-review.md");
    const handle = opts.agent.spawn({
      prompt: [
        `Execute the steps in ${todoPath}`,
        `Use run intent file: ${userIntentPath}`,
        `When main tasks are complete, write intent review to: ${intentReviewPath}`,
      ].join("\n"),
      systemPrompt: EXECUTE_TODOS_SYSTEM_PROMPT,
      readonly: false,
      cwd: opts.workingDir,
      log: opts.log,
      outputFormat: "stream-json",
      stdoutLogPath: path.join(opts.artifactsDir, `${stepLogPrefix}-claude.stdout.log`),
      stderrLogPath: path.join(opts.artifactsDir, `${stepLogPrefix}-claude.stderr.log`),
      mcpConfigs: integrations.mcpConfigs,
      env: integrations.env,
    });
    await handle.done;
  } catch (err) {
    return {
      success: false,
      summary: `Chat command failed: ${(err as Error).message}`,
    };
  }

  const result = readExecutionResult(opts.artifactsDir);
  if (result.todoFullyComplete == null) {
    result.todoFullyComplete = isMainTodoFullyComplete(todoPath);
  }
  if (result.todoFullyComplete) {
    result.intentAligned = isIntentAligned(opts.artifactsDir);
    if (!result.intentAligned && result.success) {
      result.success = false;
      result.summary =
        "Main TODO appears complete, but artifacts/intent-review.md is missing or reports deviations.";
    }
  }
  return result;
}

export function readExecutionResult(artifactsDir: string): StepResult {
  const resultPath = path.join(artifactsDir, "execution_result.json");
  try {
    const raw = fs.readFileSync(resultPath, "utf-8");
    const parsed = JSON.parse(raw) as StepResult;
    fs.unlinkSync(resultPath);
    return parsed;
  } catch {
    return { success: true, summary: "No execution_result.json found — assumed success" };
  }
}

function isMainTodoFullyComplete(todoPath: string): boolean {
  let content: string;
  try {
    content = fs.readFileSync(todoPath, "utf-8");
  } catch {
    return false;
  }

  const mainSection = content.split(/\n#\s+Failure Tasks\b/, 1)[0];
  const matches = [...mainSection.matchAll(/^\s*-\s\[(.)\]/gm)];
  if (matches.length === 0) return false;

  return matches.every((m) => {
    const mark = (m[1] ?? "").toLowerCase();
    return mark === "x" || mark === "s";
  });
}

function isIntentAligned(artifactsDir: string): boolean {
  const reviewPath = path.join(artifactsDir, "intent-review.md");
  let content: string;
  try {
    content = fs.readFileSync(reviewPath, "utf-8");
  } catch {
    return false;
  }

  const hasHeader = /(^|\n)##\s+Intent Alignment\b/i.test(content);
  const hasFulfilled = /(^|\n)###\s+Fulfilled Requirements\b/i.test(content);
  const hasDeviations = /(^|\n)###\s+Deviations\b/i.test(content);
  const hasEvidence = /(^|\n)###\s+Evidence\b/i.test(content);
  if (!(hasHeader && hasFulfilled && hasDeviations && hasEvidence)) {
    return false;
  }

  const deviationsMatch = content.match(
    /###\s+Deviations[\s\S]*?(?=\n###\s+|\s*$)/i,
  );
  if (!deviationsMatch) return false;
  const deviationsBody = deviationsMatch[0]
    .replace(/###\s+Deviations/i, "")
    .trim();
  return /^none[.\s]*$/i.test(deviationsBody);
}

// --- Pure state machine ---

export type AdvanceAction =
  | "next"
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
  context?: TemplateContext,
  log?: Logger,
): AdvanceResult {
  const currentStep = workflow.steps[state.step_index];

  // Step failed
  if (!stepResult.success) {
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
  return toNextStep(workflow, state, stepResult, context, log);
}

function getStepName(step: WorkflowStepDef, index: number): string {
  return step.name || `step-${index}`;
}

function getStepMaxAttempts(_step: WorkflowStepDef): number {
  return 1;
}

function toNextStep(
  workflow: WorkflowDef,
  state: WorkflowRunState,
  stepResult: StepResult,
  context?: TemplateContext,
  log?: Logger,
): AdvanceResult {
  if (stepResult.todoFullyComplete) {
    if (stepResult.intentAligned === false) {
      return {
        action: "failed",
        state: {
          ...state,
          status: "failed",
          error:
            stepResult.summary
            ?? "Run cannot complete: intent-review.md is missing or contains deviations.",
          updated_at: new Date().toISOString(),
        },
      };
    }
    const lastIndex = Math.max(0, workflow.steps.length - 1);
    const lastStep = workflow.steps[lastIndex];
    return {
      action: "completed",
      state: {
        ...state,
        status: "completed",
        step_index: lastIndex,
        step_name: getStepName(lastStep, lastIndex),
        updated_at: new Date().toISOString(),
      },
    };
  }

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
    if (stepResult.intentAligned === false) {
      return {
        action: "failed",
        state: {
          ...state,
          status: "failed",
          artifacts: updatedArtifacts,
          error:
            stepResult.summary
            ?? "Run cannot complete: intent-review.md is missing or contains deviations.",
          updated_at: new Date().toISOString(),
        },
      };
    }
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
  const nextStatus: WorkflowRunStatus = shouldAwaitApproval(nextStep, context, log)
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

function shouldAwaitApproval(
  step: WorkflowStepDef,
  context?: TemplateContext,
  log?: Logger,
): boolean {
  if (step.kind !== "prompt") return false;
  if (!context) {
    // Backwards-safe fallback if caller does not provide context.
    return shouldAwaitApprovalForPrompt(step, {}, log);
  }
  return shouldAwaitApprovalForPrompt(step, context, log);
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

    // Check conditional execution
    if (step.if) {
      const shouldRun = evaluateCondition(step.if, currentState);
      if (!shouldRun) {
        const skipResult: StepResult = {
          success: true,
          summary: "Skipped (condition not met)",
        };
        const { state: nextState } = advanceWorkflow(
          workflow,
          currentState,
          skipResult,
          context,
          opts.log,
        );
        currentState = nextState;
        persistState(currentState, opts.statePath);
        opts.onStateChange?.(currentState);
        continue;
      }
    }

    const result = await executeWorkflowSlice(
      workflow,
      currentState.step_index,
      context,
      opts,
    );

    const { state: nextState } = advanceWorkflow(
      workflow,
      currentState,
      result,
      context,
      opts.log,
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
