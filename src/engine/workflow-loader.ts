import fs from "node:fs";
import path from "node:path";
import { discoverWorkflowTemplateMap, type WorkflowTemplateMap } from "./workflow-discovery.js";
import { parseWorkflow, validateWorkflow, type ValidationError } from "./workflow-parser.js";
import { resolveTemplate, type TemplateContext } from "./workflow-template.js";
import type {
  ParsedWorkflowStepDef,
  PromptStepDef,
  StepCondition,
  StepOutcomeCondition,
  WorkflowCallStepDef,
  WorkflowDef,
  WorkflowInput,
  WorkflowStepDef,
} from "./workflow-types.js";

export interface LoadWorkflowOpts {
  repoDir?: string;
  rootDir?: string;
}

interface LoadWorkflowContext extends Required<Pick<LoadWorkflowOpts, "rootDir">> {
  repoDir?: string;
  stack: string[];
  workflows: WorkflowTemplateMap;
}

export function loadWorkflowFromFile(
  workflowPath: string,
  opts: LoadWorkflowOpts = {},
): WorkflowDef {
  const resolvedPath = path.resolve(workflowPath);
  const rootDir = path.resolve(opts.rootDir ?? path.dirname(resolvedPath));
  assertPathWithinRoot(resolvedPath, rootDir, "Workflow file");

  return loadWorkflowFromFileInternal(resolvedPath, {
    rootDir,
    repoDir: opts.repoDir,
    stack: [],
    workflows: discoverWorkflowTemplateMap(rootDir),
  });
}

function loadWorkflowFromFileInternal(
  workflowPath: string,
  ctx: LoadWorkflowContext,
): WorkflowDef {
  if (ctx.stack.includes(workflowPath)) {
    const chain = [...ctx.stack, workflowPath].map((file) => path.basename(file)).join(" -> ");
    throw new Error(`Nested workflow cycle detected: ${chain}`);
  }

  const raw = fs.readFileSync(workflowPath, "utf-8");
  const parsed = parseWorkflow(raw);
  const localErrors = validateWorkflow(parsed, {
    repoDir: ctx.repoDir,
    workflowsDir: ctx.rootDir,
  });
  if (localErrors.length > 0) {
    throw new Error(formatValidationErrors(workflowPath, localErrors));
  }

  const nextCtx: LoadWorkflowContext = {
    ...ctx,
    stack: [...ctx.stack, workflowPath],
  };
  const workflow: WorkflowDef = {
    ...parsed,
    steps: expandSteps(parsed.steps, workflowPath, nextCtx),
  };
  const expandedErrors = validateWorkflow(workflow, {
    repoDir: ctx.repoDir,
    workflowsDir: ctx.rootDir,
  });
  if (expandedErrors.length > 0) {
    throw new Error(formatValidationErrors(workflowPath, expandedErrors));
  }

  return workflow;
}

function expandSteps(
  steps: ParsedWorkflowStepDef[],
  sourceWorkflowPath: string,
  ctx: LoadWorkflowContext,
): WorkflowStepDef[] {
  const expanded: WorkflowStepDef[] = [];

  for (const step of steps) {
    switch (step.kind) {
      case "workflow":
        expanded.push(...expandWorkflowCallStep(step, sourceWorkflowPath, ctx));
        break;
      case "foreach":
        expanded.push({
          ...step,
          steps: expandSteps(step.steps, sourceWorkflowPath, ctx),
        });
        break;
      case "prompt":
        expanded.push(expandPromptStep(step, sourceWorkflowPath, ctx));
        break;
      case "script":
        expanded.push(step);
        break;
    }
  }

  return expanded;
}

function expandPromptStep(
  step: PromptStepDef,
  sourceWorkflowPath: string,
  ctx: LoadWorkflowContext,
): PromptStepDef {
  if (!step.branch) return step;

  return {
    ...step,
    branch: {
      if: {
        ...step.branch.if,
        steps: expandSteps(step.branch.if.steps, sourceWorkflowPath, ctx),
      },
      else: {
        ...step.branch.else,
        steps: expandSteps(step.branch.else.steps, sourceWorkflowPath, ctx),
      },
    },
  };
}

function expandWorkflowCallStep(
  step: WorkflowCallStepDef,
  sourceWorkflowPath: string,
  ctx: LoadWorkflowContext,
): WorkflowStepDef[] {
  const nestedPath = resolveWorkflowReference(step.workflow.name, sourceWorkflowPath, ctx);
  const nestedWorkflow = loadWorkflowFromFileInternal(nestedPath, ctx);
  const nestedInputs = buildNestedInputContext(nestedWorkflow.inputs, step, nestedPath);
  const resolvedSteps = resolveChildInputTemplates(nestedWorkflow.steps, nestedInputs);

  const injected: WorkflowStepDef[] = [];
  for (const childStep of resolvedSteps) {
    const merged = applyInheritedCondition(childStep, step.condition);
    if (merged) injected.push(merged);
  }
  return injected;
}

function resolveWorkflowReference(
  reference: string,
  sourceWorkflowPath: string,
  ctx: LoadWorkflowContext,
): string {
  const resolvedReference = resolveTemplate(reference, { workflows: ctx.workflows });
  if (resolvedReference.includes("${{")) {
    throw new Error(
      `Nested workflow reference "${reference}" in ${path.basename(sourceWorkflowPath)} could not be resolved`,
    );
  }

  const resolved = path.resolve(path.dirname(sourceWorkflowPath), resolvedReference);
  assertPathWithinRoot(resolved, ctx.rootDir, `Nested workflow "${resolvedReference}"`);
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `Nested workflow "${resolvedReference}" not found from ${path.basename(sourceWorkflowPath)}: ${resolved}`,
    );
  }
  return resolved;
}

function assertPathWithinRoot(filePath: string, rootDir: string, label: string): void {
  const relative = path.relative(rootDir, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay within ${rootDir}: ${filePath}`);
  }
}

function buildNestedInputContext(
  declaredInputs: Record<string, WorkflowInput> | undefined,
  step: WorkflowCallStepDef,
  nestedPath: string,
): Record<string, string | boolean | number> {
  const declared = declaredInputs ?? {};
  const provided = step.workflow.inputs ?? {};
  const context: Record<string, string | boolean | number> = {};

  for (const [name, input] of Object.entries(declared)) {
    if (input.default != null) {
      context[name] = input.default;
    }
  }

  for (const [name, value] of Object.entries(provided)) {
    if (!(name in declared)) {
      throw new Error(
        `Nested workflow "${path.basename(nestedPath)}" does not declare input "${name}" required by step "${step.name}"`,
      );
    }
    context[name] = value;
  }

  const missing = Object.entries(declared)
    .filter(([name, input]) => input.required && context[name] == null)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      `Nested workflow "${path.basename(nestedPath)}" is missing required inputs for step "${step.name}": ${missing.join(", ")}`,
    );
  }

  return context;
}

function resolveChildInputTemplates(
  steps: WorkflowStepDef[],
  inputs: Record<string, string | boolean | number>,
): WorkflowStepDef[] {
  return resolveValueStrings(steps, { inputs }) as WorkflowStepDef[];
}

function resolveValueStrings(
  value: unknown,
  context: TemplateContext,
): unknown {
  if (typeof value === "string") {
    return resolveTemplate(value, context);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveValueStrings(item, context));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = resolveValueStrings(nested, context);
    }
    return out;
  }
  return value;
}

function applyInheritedCondition(
  step: WorkflowStepDef,
  inherited: StepCondition | undefined,
): WorkflowStepDef | null {
  if (!inherited) return step;
  const merged = mergeConditions(inherited, step.condition);
  if (merged === null) return null;
  return {
    ...step,
    ...(merged ? { condition: merged } : {}),
  };
}

function mergeConditions(
  parent: StepCondition | undefined,
  child: StepCondition | undefined,
): StepCondition | undefined | null {
  if (!parent) return child;
  if (!child) return parent;

  const outcome = mergeOutcomes(parent.outcome, child.outcome);
  if (outcome == null) return null;

  const aiCondition = combineAiConditions(parent.ai_condition, child.ai_condition);
  return aiCondition
    ? { outcome, ai_condition: aiCondition }
    : { outcome };
}

function mergeOutcomes(
  parent: StepOutcomeCondition,
  child: StepOutcomeCondition,
): StepOutcomeCondition | null {
  if (parent === "always") return child;
  if (child === "always") return parent;
  if (parent === child) return parent;
  return null;
}

function combineAiConditions(
  parent: string | undefined,
  child: string | undefined,
): string | undefined {
  if (!parent) return child;
  if (!child) return parent;
  return `(${parent}) and (${child})`;
}

function formatValidationErrors(
  workflowPath: string,
  errors: ValidationError[],
): string {
  const lines = [`Workflow validation failed for ${workflowPath}:`];
  for (const error of errors) {
    lines.push(`- ${error.path}: ${error.message}`);
  }
  return lines.join("\n");
}
