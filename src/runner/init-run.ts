import fs from "node:fs";
import path from "node:path";
import type { Trigger } from "@/ingestor/trigger.js";
import { parseWorkflow } from "@/engine/workflow-parser.js";
import { initWorkflowRunState } from "@/engine/workflow-runner.js";
import {
  repoWorkflowsDir,
  worktreeDir,
  runDir,
  runStatePath,
} from "@/util/paths.js";
import { createWorktree } from "@/engine/worktree.js";
import {
  collectRequiredIntegrations,
  checkRequiredIntegrations,
} from "@/engine/integration-checker.js";
import { log } from "@/util/logger.js";

export interface TriageResult {
  repoSlug: string;
  workflowFile: string;
  workflowName: string;
  inputs: Record<string, string>;
  worktreeId?: string;
}

export interface InitRunResult {
  repoSlug: string;
  worktreeId: string;
  runId: string;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function initRun(
  triageResult: TriageResult,
  trigger: Trigger,
): Promise<InitRunResult> {
  const { repoSlug, workflowFile, inputs } = triageResult;

  // Read and parse workflow definition
  const workflowPath = path.join(repoWorkflowsDir(repoSlug), workflowFile);
  if (!fs.existsSync(workflowPath)) {
    throw new Error(`Workflow file not found: ${workflowPath}`);
  }
  const workflowContent = fs.readFileSync(workflowPath, "utf-8");
  const workflow = parseWorkflow(workflowContent);

  // Validate required integrations
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

  let worktreeId: string;
  let runId: string;

  if (action === "inherit") {
    if (!triageResult.worktreeId) {
      throw new Error(
        `Workflow "${workflow.name}" has worktree.action "inherit" but no worktreeId was provided`,
      );
    }
    worktreeId = triageResult.worktreeId;

    // Verify the worktree directory exists
    const wtDir = worktreeDir(repoSlug, worktreeId);
    if (!fs.existsSync(wtDir)) {
      throw new Error(
        `Worktree directory does not exist for inherit: ${wtDir}`,
      );
    }

    runId = `${slugify(workflow.name)}-${Date.now()}`;
  } else {
    // "create" (default)
    worktreeId = `${slugify(workflow.name)}-${Date.now()}`;
    runId = worktreeId;

    await createWorktree(repoSlug, worktreeId);
  }

  // Create run directory
  const rDir = runDir(repoSlug, worktreeId, runId);
  fs.mkdirSync(rDir, { recursive: true });

  // Write workflow_state.json
  const state = initWorkflowRunState(workflow, workflowFile, inputs);
  const statePath = runStatePath(repoSlug, worktreeId, runId);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

  // Write trigger.json for dedup
  const triggerPath = path.join(rDir, "trigger.json");
  fs.writeFileSync(
    triggerPath,
    JSON.stringify({ id: trigger.id, source: trigger.source, groupKeys: trigger.groupKeys }, null, 2),
  );

  log.info(
    `Initialized run ${repoSlug}/${worktreeId}/runs/${runId} for workflow "${workflow.name}"`,
  );

  return { repoSlug, worktreeId, runId };
}
