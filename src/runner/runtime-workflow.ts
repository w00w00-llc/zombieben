import fs from "node:fs";
import { parseWorktreesConfig } from "@/engine/workflow-parser.js";
import type { WorkflowDef } from "@/engine/workflow-types.js";
import { repoWorktreesConfigPath } from "@/util/paths.js";

/**
 * Build runtime workflow steps for a run.
 * For worktree.action=create, prepend setup_steps from worktrees.yml.
 */
export function prepareWorkflowForRun(
  repoSlug: string,
  workflow: WorkflowDef,
): WorkflowDef {
  const action = workflow.worktree?.action ?? "create";
  if (action !== "create") return workflow;

  const configPath = repoWorktreesConfigPath(repoSlug);
  if (!fs.existsSync(configPath)) return workflow;

  let setupSteps: WorkflowDef["steps"];
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    setupSteps = parseWorktreesConfig(raw).setup_steps;
  } catch {
    // Invalid or unreadable config should not block workflow execution.
    return workflow;
  }

  if (setupSteps.length === 0) return workflow;

  return {
    ...workflow,
    steps: [...setupSteps, ...workflow.steps],
    worktree_setup_start_index: 0,
    worktree_setup_count: setupSteps.length,
  };
}
