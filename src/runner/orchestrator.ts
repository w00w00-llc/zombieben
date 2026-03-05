import fs from "node:fs";
import { scanActiveRuns, type ActiveRun } from "./scanner.js";
import { parseWorkflow } from "@/workflow/parser.js";
import {
  advanceWorkflow,
  type RunWorkflowOpts,
} from "@/engine/workflow-runner.js";
import { executeStep } from "@/engine/step-runner.js";
import { executeBuiltin } from "@/engine/builtins.js";
import {
  repoWorkflowsDir,
  worktreeRepoDir,
  worktreeArtifactsDir,
} from "@/util/paths.js";
import type { TemplateContext } from "@/workflow/template.js";
import type { StepResult } from "@/engine/step-runner.js";
import path from "node:path";
import { log } from "@/util/logger.js";

/**
 * Single tick of the orchestrator: find active runs and advance them.
 */
export async function processTick(): Promise<void> {
  const activeRuns = scanActiveRuns();

  for (const run of activeRuns) {
    try {
      await processRun(run);
    } catch (err) {
      log.error(
        `Error processing ${run.repoSlug}/${run.worktreeId}: ${(err as Error).message}`
      );
    }
  }
}

async function processRun(run: ActiveRun): Promise<void> {
  const { repoSlug, worktreeId, state, statePath } = run;

  // Load workflow definition
  const workflowsDir = repoWorkflowsDir(repoSlug);
  const workflowPath = path.join(workflowsDir, state.workflow_file);

  if (!fs.existsSync(workflowPath)) {
    log.error(`Workflow file not found: ${workflowPath}`);
    return;
  }

  const workflowContent = fs.readFileSync(workflowPath, "utf-8");
  const workflow = parseWorkflow(workflowContent);

  const workingDir = worktreeRepoDir(repoSlug, worktreeId);
  const artifactsDir = worktreeArtifactsDir(repoSlug, worktreeId);

  // Build template context
  const context: TemplateContext = {
    inputs: state.inputs as Record<string, unknown>,
    artifacts: state.artifacts,
    output_artifacts: {},
    skills: {},
    worktree: { id: worktreeId, path: workingDir },
    zombieben: { repo_slug: repoSlug },
  };

  const step = workflow.steps[state.step_index];

  let result: StepResult;

  if (step.kind === "builtin") {
    result = await executeBuiltin(step, context);
  } else {
    const opts: RunWorkflowOpts = {
      chatCommand: "claude",
      workingDir,
      artifactsDir,
      statePath,
    };
    result = await executeStep(step, context, opts);
  }

  const { action, state: nextState } = advanceWorkflow(
    workflow,
    state,
    result
  );

  fs.writeFileSync(statePath, JSON.stringify(nextState, null, 2));

  log.info(
    `${repoSlug}/${worktreeId}: ${state.step_name} → ${action} (${nextState.status})`
  );
}
