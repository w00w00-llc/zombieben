import type { WorkflowStepDef, BuiltinStepDef } from "@/workflow/types/index.js";
import type { TemplateContext } from "@/workflow/template.js";
import type { StepResult } from "./step-runner.js";
import { createWorktree } from "@/util/worktree.js";

export function isBuiltinStep(step: WorkflowStepDef): step is BuiltinStepDef {
  return step.kind === "builtin";
}

export async function executeBuiltin(
  step: BuiltinStepDef,
  context: TemplateContext
): Promise<StepResult> {
  const action = step.uses.replace(/^zombieben\./, "");

  switch (action) {
    case "create_worktree":
      return executeCreateWorktree(context);
    default:
      return {
        success: false,
        summary: `Unknown builtin action: ${action}`,
      };
  }
}

async function executeCreateWorktree(
  context: TemplateContext
): Promise<StepResult> {
  const repoSlug = context.zombieben?.repo_slug as string | undefined;
  const worktreeId = context.worktree?.id as string | undefined;

  if (!repoSlug || !worktreeId) {
    return {
      success: false,
      summary: "Missing repo_slug or worktree id in context",
    };
  }

  try {
    const worktreePath = await createWorktree(repoSlug, worktreeId);
    return {
      success: true,
      summary: `Created worktree at ${worktreePath}`,
      artifacts: [worktreePath],
    };
  } catch (err) {
    return {
      success: false,
      summary: `Failed to create worktree: ${(err as Error).message}`,
    };
  }
}
