import fs from "node:fs";
import path from "node:path";
import type { Trigger } from "@/ingestor/trigger.js";
import { parseWorkflow } from "@/workflow/parser.js";
import { initWorkflowRunState } from "@/engine/workflow-runner.js";
import {
  repoWorkflowsDir,
  worktreeDir,
  worktreeStatePath,
} from "@/util/paths.js";
import { log } from "@/util/logger.js";

export interface TriageResult {
  repoSlug: string;
  workflowFile: string;
  workflowName: string;
  inputs: Record<string, string>;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function initRun(
  triageResult: TriageResult,
  trigger: Trigger,
): void {
  const { repoSlug, workflowFile, inputs } = triageResult;

  // Read and parse workflow definition
  const workflowPath = path.join(repoWorkflowsDir(repoSlug), workflowFile);
  if (!fs.existsSync(workflowPath)) {
    throw new Error(`Workflow file not found: ${workflowPath}`);
  }
  const workflowContent = fs.readFileSync(workflowPath, "utf-8");
  const workflow = parseWorkflow(workflowContent);

  // Generate worktree ID
  const worktreeId = `${slugify(workflow.name)}-${Date.now()}`;

  // Create directory structure
  const wtDir = worktreeDir(repoSlug, worktreeId);
  fs.mkdirSync(wtDir, { recursive: true });

  // Write workflow_state.json
  const state = initWorkflowRunState(workflow, workflowFile, inputs);
  const statePath = worktreeStatePath(repoSlug, worktreeId);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

  // Write trigger.json for dedup
  const triggerPath = path.join(wtDir, "trigger.json");
  fs.writeFileSync(
    triggerPath,
    JSON.stringify({ id: trigger.id, source: trigger.source, groupKeys: trigger.groupKeys }, null, 2),
  );

  log.info(
    `Initialized run ${repoSlug}/${worktreeId} for workflow "${workflow.name}"`,
  );
}
