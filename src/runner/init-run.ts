import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { Trigger } from "@/ingestor/trigger.js";
import { parseWorkflow } from "@/engine/workflow-parser.js";
import { initWorkflowRunState } from "@/engine/workflow-runner.js";
import {
  mainRepoDir,
  repoWorkflowsDir,
  worktreeDir,
  worktreeRepoDir,
  runDir,
  runArtifactsDir,
  runStatePath,
} from "@/util/paths.js";
import { createWorktree } from "@/engine/worktree.js";
import {
  collectRequiredIntegrations,
  checkRequiredIntegrations,
} from "@/engine/integration-checker.js";
import { log } from "@/util/logger.js";
import { syncRepo, rebaseWorktreeOntoDefaultBranch } from "./repo-sync.js";
import { prepareWorkflowForRun } from "./runtime-workflow.js";
import { extractArtifactNames, resolveTemplate } from "@/engine/workflow-template.js";
import type { TemplateContext } from "@/engine/workflow-template.js";
import type { WorkflowDef } from "@/engine/workflow-types.js";
import { createTodoMarkdown } from "@/engine/todo-generator.js";

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

function makeTimestampSlug(name: string): string {
  return `${Date.now()}-${slugify(name)}`;
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
  const parsedWorkflow = parseWorkflow(workflowContent);

  // Validate required integrations
  const required = collectRequiredIntegrations(parsedWorkflow);
  if (required.size > 0) {
    const check = checkRequiredIntegrations(required);
    if (!check.ok) {
      const names = check.missing.map((n) => `"${n}"`).join(", ");
      throw new Error(
        `Workflow "${parsedWorkflow.name}" requires integration ${names} but ${
          check.missing.length === 1 ? "it is" : "they are"
        } not configured. Add the required keys to keys.json before running this workflow.`,
      );
    }
  }

  const action = parsedWorkflow.worktree?.action ?? "create";

  let worktreeId: string;
  let runId: string;

  if (action === "inherit") {
    if (!triageResult.worktreeId) {
      throw new Error(
        `Workflow "${parsedWorkflow.name}" has worktree.action "inherit" but no worktreeId was provided`,
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

    runId = makeTimestampSlug(parsedWorkflow.name);
  } else {
    // "create" (default)
    worktreeId = makeTimestampSlug(parsedWorkflow.name);
    runId = worktreeId;

    await syncRepo(repoSlug);
    await createWorktree(repoSlug, worktreeId);
  }

  // Ensure worktree branch is rebased to latest default branch before any step runs.
  await rebaseWorktreeOntoDefaultBranch(repoSlug, worktreeId);

  const workflow = prepareWorkflowForRun(repoSlug, parsedWorkflow);

  // Create run directory
  const rDir = runDir(repoSlug, worktreeId, runId);
  fs.mkdirSync(rDir, { recursive: true });
  const artifactsDir = runArtifactsDir(repoSlug, worktreeId, runId);
  fs.mkdirSync(artifactsDir, { recursive: true });

  // Write workflow_state.json
  const state = initWorkflowRunState(workflow, workflowFile, inputs);
  const statePath = runStatePath(repoSlug, worktreeId, runId);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

  // Write full trigger payload for run history/debugging.
  const triggerPath = path.join(rDir, "trigger.json");
  fs.writeFileSync(triggerPath, JSON.stringify(trigger, null, 2));

  // Pre-populate artifact paths so they resolve in workflow snapshot.
  const artifacts = buildDeterministicArtifactMap(workflow, artifactsDir);
  const skills = discoverSkills(worktreeRepoDir(repoSlug, worktreeId));

  // Persist resolved workflow snapshot for debugging.
  const resolvedWorkflow = resolveWorkflowTemplates(workflow, {
    inputs,
    artifacts,
    skills,
    worktree: {
      id: worktreeId,
      slug: worktreeId,
      path: worktreeRepoDir(repoSlug, worktreeId),
    },
    zombieben: {
      repo_slug: repoSlug,
      trigger: triggerPath,
      main_repo: mainRepoDir(repoSlug),
    },
  }) as typeof workflow;
  const resolvedWorkflowPath = path.join(
    artifactsDir,
    "workflow.resolved.yml",
  );
  fs.writeFileSync(
    resolvedWorkflowPath,
    yaml.dump(resolvedWorkflow, { noRefs: true, lineWidth: -1 }),
  );

  // Persist initial TODO at run creation time.
  const todoPath = path.join(artifactsDir, "TODO.md");
  fs.writeFileSync(todoPath, createTodoMarkdown(resolvedWorkflow, {}, 0));

  log.info(
    `Initialized run ${repoSlug}/${worktreeId}/runs/${runId} for workflow "${workflow.name}"`,
  );

  return { repoSlug, worktreeId, runId };
}

function resolveWorkflowTemplates(
  value: unknown,
  context: TemplateContext,
): unknown {
  if (typeof value === "string") {
    return resolveTemplate(value, context);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveWorkflowTemplates(item, context));
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(obj)) {
      out[key] = resolveWorkflowTemplates(nested, context);
    }
    return out;
  }
  return value;
}

function buildDeterministicArtifactMap(
  workflow: WorkflowDef,
  artifactsDir: string,
): Record<string, string> {
  const names = new Set<string>();
  for (const step of workflow.steps) {
    collectArtifactNamesFromStep(step, names);
  }
  const artifacts: Record<string, string> = {};
  for (const name of names) {
    artifacts[name] = path.join(artifactsDir, `${name}.md`);
  }
  return artifacts;
}

function collectArtifactNamesFromStep(
  step: WorkflowDef["steps"][number],
  names: Set<string>,
): void {
  if (step.kind === "prompt") {
    for (const n of extractArtifactNames(step.prompt)) names.add(n);
    if (step.await_approval?.attachments) {
      for (const a of step.await_approval.attachments) {
        for (const n of extractArtifactNames(a)) names.add(n);
      }
    }
    if (step.branch) {
      for (const s of step.branch.if.steps) collectArtifactNamesFromStep(s, names);
      for (const s of step.branch.else.steps) collectArtifactNamesFromStep(s, names);
    }
  } else if (step.kind === "for") {
    for (const s of step.steps) collectArtifactNamesFromStep(s, names);
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
      const entries = fs.readdirSync(dir, { recursive: true }) as string[];
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) continue;
        const name = path.basename(entry, path.extname(entry));
        if (!skills[name]) {
          skills[name] = fullPath;
        }
      }
    } catch {
      // Ignore unreadable skill dirs.
    }
  }
  return skills;
}
