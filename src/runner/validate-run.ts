import fs from "node:fs";
import path from "node:path";
import { loadWorkflowFromFile } from "@/engine/workflow-loader.js";
import {
  collectRequiredIntegrations,
  checkRequiredIntegrations,
} from "@/engine/integration-checker.js";
import { repoWorkflowsDir, worktreeDir } from "@/util/paths.js";
import type { WorkflowDef } from "@/engine/workflow-types.js";
import type { RunInitRequest } from "./init-run.js";

export interface ValidateRunResult {
  workflowPath: string;
  workflow: WorkflowDef;
  action: "create" | "inherit";
}

export function validateRun(runInitRequest: RunInitRequest): ValidateRunResult {
  const { repoSlug, workflowFile } = runInitRequest;

  const workflowPath = path.join(repoWorkflowsDir(repoSlug), workflowFile);
  if (!fs.existsSync(workflowPath)) {
    throw new Error(`Workflow file not found: ${workflowPath}`);
  }

  const workflow = loadWorkflowFromFile(workflowPath, {
    repoDir: path.resolve(repoWorkflowsDir(repoSlug), "..", ".."),
    rootDir: repoWorkflowsDir(repoSlug),
  });

  const required = collectRequiredIntegrations(workflow);
  if (required.size > 0) {
    const check = checkRequiredIntegrations(required);
    if (!check.ok) {
      const names = check.missing.map((n) => `"${n}"`).join(", ");
      throw new Error(
        `Workflow "${workflow.name}" requires integration ${names} but ${
          check.missing.length === 1 ? "it is" : "they are"
        } not configured. Add the required keys to keys.json before running this workflow.`,
      );
    }
  }

  const action = workflow.worktree?.action ?? "create";
  if (action === "inherit") {
    if (!runInitRequest.worktreeId) {
      throw new Error(
        `Workflow "${workflow.name}" has worktree.action "inherit" but no worktreeId was provided`,
      );
    }
    const wtDir = worktreeDir(repoSlug, runInitRequest.worktreeId);
    if (!fs.existsSync(wtDir)) {
      throw new Error(
        `Worktree directory does not exist for inherit: ${wtDir}`,
      );
    }
  }

  return { workflowPath, workflow, action };
}
