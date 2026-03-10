import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { Trigger } from "@/ingestor/trigger.js";
import type { RoleTaggedResponder } from "@/responder/types.js";
import { initWorkflowRunState } from "@/engine/workflow-runner.js";
import {
  mainRepoDir,
  worktreeRepoDir,
  runDir,
  runArtifactsDir,
  runStatePath,
} from "@/util/paths.js";
import { createWorktree } from "@/engine/worktree.js";
import { log } from "@/util/logger.js";
import { syncRepo, rebaseWorktreeOntoDefaultBranch } from "./repo-sync.js";
import { prepareWorkflowForRun } from "./runtime-workflow.js";
import { extractArtifactNames, resolveTemplate } from "@/engine/workflow-template.js";
import type { TemplateContext } from "@/engine/workflow-template.js";
import type { WorkflowDef } from "@/engine/workflow-types.js";
import { createTodoMarkdown } from "@/engine/todo-generator.js";
import { validateRun } from "./validate-run.js";
import {
  serializeRunResponders,
  writeRunRespondersSnapshot,
} from "@/responder/run-responders.js";

export interface RunInitRequest {
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
  runInitRequest: RunInitRequest,
  trigger: Trigger,
  responders: readonly RoleTaggedResponder[] = [],
): Promise<InitRunResult> {
  const { repoSlug, workflowFile, inputs } = runInitRequest;
  const { workflow: parsedWorkflow, action } = validateRun(runInitRequest);

  let worktreeId: string;
  let runId: string;

  if (action === "inherit") {
    worktreeId = runInitRequest.worktreeId!;
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
  const responderSnapshotPath = writeRunRespondersSnapshot(
    rDir,
    serializeRunResponders(trigger, responders),
  );
  const inputsPath = path.join(rDir, "inputs.json");
  fs.writeFileSync(inputsPath, JSON.stringify(inputs, null, 2));
  const userIntentPath = path.join(rDir, "user_intent.md");
  fs.writeFileSync(userIntentPath, buildUserIntentDoc(trigger, inputs));

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
    `Initialized run ${repoSlug}/${worktreeId}/runs/${runId} for workflow "${workflow.name}" (responders: ${responderSnapshotPath})`,
  );

  return { repoSlug, worktreeId, runId };
}

function buildUserIntentDoc(
  trigger: Trigger,
  inputs: Record<string, string>,
): string {
  const originalRequest = extractOriginalRequest(trigger);
  const captureTime = new Date().toISOString();
  const contextSection =
    trigger.context == null
      ? "_none_"
      : `\`\`\`json\n${JSON.stringify(trigger.context, null, 2)}\n\`\`\``;
  return [
    "# User Intent",
    "",
    `Captured At: ${captureTime}`,
    `Trigger Source: ${trigger.source}`,
    `Trigger ID: ${trigger.id}`,
    "",
    "## Original Human Request (Verbatim)",
    "",
    originalRequest,
    "",
    "## Inputs",
    "",
    "```json",
    JSON.stringify(inputs, null, 2),
    "```",
    "",
    "## Trigger Context",
    "",
    contextSection,
    "",
  ].join("\n");
}

function extractOriginalRequest(trigger: Trigger): string {
  if (typeof trigger.raw_payload === "object" && trigger.raw_payload !== null) {
    const raw = trigger.raw_payload as Record<string, unknown>;
    const direct = firstNonEmptyString([
      raw.text,
      raw.body,
      getNested(raw, ["comment", "body"]),
      getNested(raw, ["issue", "body"]),
      getNested(raw, ["pull_request", "body"]),
      getNested(raw, ["head_commit", "message"]),
    ]);
    const title = firstNonEmptyString([
      getNested(raw, ["issue", "title"]),
      getNested(raw, ["pull_request", "title"]),
    ]);
    if (title && direct) {
      return `${title}\n\n${direct}`.trim();
    }
    if (direct) return direct;
    if (title) return title;
  }

  if (typeof trigger.context === "object" && trigger.context !== null) {
    const ctx = trigger.context as Record<string, unknown>;
    const msgs = ctx.allThreadMessages;
    if (Array.isArray(msgs)) {
      for (let i = msgs.length - 1; i >= 0; i--) {
        const msg = msgs[i];
        if (!msg || typeof msg !== "object") continue;
        const text = (msg as Record<string, unknown>).text;
        if (typeof text === "string" && text.trim()) {
          return text.trim();
        }
      }
    }
  }

  return "_unavailable_";
}

function getNested(obj: Record<string, unknown>, keys: string[]): unknown {
  let cur: unknown = obj;
  for (const key of keys) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function firstNonEmptyString(values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
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
  } else if (step.kind === "foreach") {
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
