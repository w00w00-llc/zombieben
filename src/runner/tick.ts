import fs, { globSync } from "node:fs";
import { scanActiveRuns, type ActiveRun } from "./scanner.js";
import { loadWorkflowFromFile } from "@/engine/workflow-loader.js";
import { discoverWorkflowTemplateMap } from "@/engine/workflow-discovery.js";
import { readWorktreeMetadata } from "@/engine/worktree-metadata.js";
import {
  advanceWorkflow,
  executeWorkflowSlice,
  type RunWorkflowOpts,
  type StepResult,
} from "@/engine/workflow-runner.js";
import {
  repoWorkflowsDir,
  worktreeRepoDir,
  runArtifactsDir,
  runDir as getRunDir,
  runLogPath,
  worktreeMetadataPath,
} from "@/util/paths.js";
import type { TemplateContext } from "@/engine/workflow-template.js";
import { extractArtifactNames, resolveTemplate } from "@/engine/workflow-template.js";
import type { CodingAgent } from "@/codingagents/index.js";
import type { WorkflowDef, WorkflowStepDef } from "@/engine/workflow-types.js";
import path from "node:path";
import { log, createLogger } from "@/util/logger.js";
import { prepareWorkflowForRun } from "./runtime-workflow.js";
import { sendRunMessage } from "./run-notify.js";

let _agent: CodingAgent | undefined;

export function setAgent(agent: CodingAgent): void {
  _agent = agent;
}

/**
 * Single tick of the orchestrator: find active runs and advance them.
 */
export async function processTick(): Promise<void> {
  const activeRuns = scanActiveRuns();

  const results = await Promise.allSettled(activeRuns.map(processRun));
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "rejected") {
      const run = activeRuns[i];
      log.error(
        `Error processing ${run.repoSlug}/${run.worktreeId}/${run.runId}: ${(result.reason as Error).message}`
      );
    }
  }
}

async function processRun(run: ActiveRun): Promise<void> {
  const { repoSlug, worktreeId, runId, state, statePath } = run;

  const runLog = createLogger({ logFile: runLogPath(repoSlug, worktreeId, runId) });

  // Load workflow definition
  const workflowsDir = repoWorkflowsDir(repoSlug);
  const workflowPath = path.join(workflowsDir, state.workflow_file);

  if (!fs.existsSync(workflowPath)) {
    runLog.error(`Workflow file not found: ${workflowPath}`);
    return;
  }

  const workflow = prepareWorkflowForRun(
    repoSlug,
    loadWorkflowFromFile(workflowPath, {
      rootDir: workflowsDir,
    }),
  );

  const workingDir = worktreeRepoDir(repoSlug, worktreeId);
  const artifactsDir = runArtifactsDir(repoSlug, worktreeId, runId);

  // Pre-populate artifacts with deterministic paths for all referenced names
  const allArtifactNames = collectArtifactNames(workflow);
  const artifacts: Record<string, string> = { ...state.artifacts };
  for (const name of allArtifactNames) {
    if (!artifacts[name]) {
      artifacts[name] = path.join(artifactsDir, `${name}.md`);
    }
  }

  // Discover skills from worktree repo
  const skills = discoverSkills(workingDir);
  const workflows = discoverWorkflowTemplateMap(workflowsDir);
  const worktreeMetadata = readWorktreeMetadata(repoSlug, worktreeId);

  // Build template context
  const triggerPath = path.join(getRunDir(repoSlug, worktreeId, runId), "trigger.json");
  const context: TemplateContext = {
    inputs: state.inputs as Record<string, unknown>,
    artifacts,
    skills,
    workflows,
    worktree_metadata: worktreeMetadata,
    worktree: {
      id: worktreeId,
      path: workingDir,
      metadata_path: worktreeMetadataPath(repoSlug, worktreeId),
    },
    zombieben: { repo_slug: repoSlug, trigger: triggerPath },
  };

  if (!_agent) {
    throw new Error("CodingAgent not set — call setAgent() before processTick()");
  }

  const opts: RunWorkflowOpts = {
    agent: _agent,
    workingDir,
    artifactsDir,
    statePath,
    log: runLog,
  };
  const result: StepResult = await executeWorkflowSlice(workflow, state.step_index, context, opts);

  const { action, state: nextState } = advanceWorkflow(
    workflow,
    state,
    result,
    context,
    runLog,
  );

  fs.writeFileSync(statePath, JSON.stringify(nextState, null, 2));

  runLog.info(
    `${repoSlug}/${worktreeId}/${runId}: ${state.step_name} → ${action} (${nextState.status})`
  );

  if (action === "awaiting_approval") {
    const approvalRequest = buildAwaitApprovalRequest(
      workflow,
      nextState.step_index,
      context,
      workingDir,
      runLog,
    );
    await sendRunMessage(
      { repoSlug, worktreeId, runId },
      approvalRequest.message,
      undefined,
      { attachments: approvalRequest.attachments },
    );
  }
}

function collectArtifactNames(workflow: WorkflowDef): string[] {
  const names = new Set<string>();
  for (const step of workflow.steps) {
    collectArtifactNamesFromStep(step, names);
  }
  return [...names];
}

function collectArtifactNamesFromStep(step: WorkflowDef["steps"][number], names: Set<string>): void {
  if (step.kind === "prompt") {
    for (const n of extractArtifactNames(step.prompt)) names.add(n);
    if (step.await_approval?.attachments) {
      for (const a of step.await_approval.attachments) {
        for (const n of extractArtifactNames(a)) names.add(n);
      }
    }
    if (step.branch) {
      for (const s of step.branch.if.steps as WorkflowStepDef[]) collectArtifactNamesFromStep(s, names);
      for (const s of step.branch.else.steps as WorkflowStepDef[]) collectArtifactNamesFromStep(s, names);
    }
  } else if (step.kind === "foreach") {
    for (const s of step.steps as WorkflowStepDef[]) collectArtifactNamesFromStep(s, names);
  }
}

function discoverSkills(repoDir: string): Record<string, string> {
  const skills: Record<string, string> = {};
  const skillDirs = [
    path.join(repoDir, ".zombieben", "skills"),
    path.join(repoDir, ".agents", "skills"),
  ];

  for (const dir of skillDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = globSync("**/*", { cwd: dir });
      for (const file of files) {
        const fullPath = path.join(dir, file);
        if (!fs.statSync(fullPath).isFile()) continue;
        const name = path.basename(file, path.extname(file));
        if (!skills[name]) {
          skills[name] = fullPath;
        }
      }
    } catch {
      // Skip if glob fails
    }
  }

  return skills;
}

function buildAwaitApprovalRequest(
  workflow: WorkflowDef,
  stepIndex: number,
  context: TemplateContext,
  workingDir: string,
  runLog: ReturnType<typeof createLogger>,
): { message: string; attachments: string[] } {
  const step = workflow.steps[stepIndex];
  if (!step || step.kind !== "prompt") {
    return {
      message: "Awaiting approval. Reply with approval or requested changes.",
      attachments: [],
    };
  }

  const requested = (step.await_approval?.attachments ?? [])
    .map((attachment) => resolveTemplate(attachment, context).trim())
    .filter(Boolean);
  const { attachments, missing } = resolveExistingAttachments(requested, workingDir);

  for (const missingAttachment of missing) {
    runLog.warn(`Approval attachment missing or not a file: ${missingAttachment}`);
  }

  const lines = [
    `Awaiting approval for step "${step.name}".`,
    "Reply with approval or requested changes to continue the run.",
  ];
  if (missing.length > 0) {
    lines.push(`Missing attachments: ${missing.map((file) => `\`${file}\``).join(", ")}`);
  }

  return {
    message: lines.join("\n"),
    attachments,
  };
}

function resolveExistingAttachments(
  requested: readonly string[],
  workingDir: string,
): { attachments: string[]; missing: string[] } {
  const seen = new Set<string>();
  const attachments: string[] = [];
  const missing: string[] = [];

  for (const candidate of requested) {
    const resolved = path.isAbsolute(candidate)
      ? candidate
      : path.resolve(workingDir, candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);

    try {
      if (fs.statSync(resolved).isFile()) {
        attachments.push(resolved);
      } else {
        missing.push(resolved);
      }
    } catch {
      missing.push(resolved);
    }
  }

  return { attachments, missing };
}
