import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { discoverWorkflowTemplateMap } from "./workflow-discovery.js";
import type {
  AwaitApproval,
  BranchDef,
  ElseBranch,
  ForeachStepDef,
  IfBranch,
  ParsedWorkflowDef,
  ParsedWorkflowStepDef,
  PromptStepDef,
  RequiredIntegrations,
  ScriptStepDef,
  StepCondition,
  WorkflowCallStepDef,
  WorkflowDef,
  WorkflowInput,
  WorkflowStepDef,
  WorktreeConfig,
} from "./workflow-types.js";
import type {
  CleanupEvent,
  WorktreesConfig,
} from "./worktrees-config.js";

// --- Validation ---

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidateWorkflowOpts {
  repoDir?: string;
  workflowsDir?: string;
}

// --- Parsing ---

export function parseWorkflow(yamlContent: string): ParsedWorkflowDef {
  const raw = yaml.load(yamlContent) as Record<string, unknown>;
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid workflow YAML: expected an object");
  }

  return {
    name: raw.name as string,
    ...(raw.confirmation_required === true ? { confirmation_required: true } : {}),
    worktree: raw.worktree ? parseWorktreeConfig(raw.worktree) : undefined,
    inputs: raw.inputs ? parseInputs(raw.inputs as Record<string, unknown>) : undefined,
    steps: parseSteps(raw.steps as unknown[], { allowWorkflowCalls: true }),
  };
}

export function parseWorktreesConfig(yamlContent: string): WorktreesConfig {
  const raw = yaml.load(yamlContent) as Record<string, unknown>;
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid worktrees YAML: expected an object");
  }

  return {
    setup_steps: parseExecutableSteps(raw.setup_steps as unknown[]),
    cleanup_on: parseCleanupEvents(raw.cleanup_on as unknown[]),
  };
}

function parseWorktreeConfig(raw: unknown): WorktreeConfig {
  const obj = raw as Record<string, unknown>;
  return {
    action: obj.action as WorktreeConfig["action"],
    ...(obj.parents != null ? { parents: obj.parents as string[] } : {}),
  };
}

function parseInputs(raw: Record<string, unknown>): Record<string, WorkflowInput> {
  const inputs: Record<string, WorkflowInput> = {};
  for (const [key, val] of Object.entries(raw)) {
    const obj = val as Record<string, unknown>;
    inputs[key] = {
      description: (obj.description as string) ?? "",
      required: (obj.required as boolean) ?? false,
      type: (obj.type as WorkflowInput["type"]) ?? "string",
      ...(obj.default != null ? { default: obj.default as string | boolean | number } : {}),
    };
  }
  return inputs;
}

function parseExecutableSteps(raw: unknown[]): WorkflowStepDef[] {
  return parseSteps(raw, { allowWorkflowCalls: false }) as WorkflowStepDef[];
}

function parseSteps(
  raw: unknown[],
  opts: { allowWorkflowCalls: boolean },
): ParsedWorkflowStepDef[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => parseStep(s as Record<string, unknown>, opts));
}

function parseStep(
  raw: Record<string, unknown>,
  opts: { allowWorkflowCalls: boolean },
): ParsedWorkflowStepDef {
  const stepName = (raw.name as string) ?? "";
  const condition = parseCondition(raw.if);
  const stepKinds = ["prompt", "runs", "foreach", "workflow"].filter((field) => raw[field] != null);
  if (stepKinds.length > 1) {
    throw new Error(
      `Step "${stepName}" has multiple step definitions (${stepKinds.join(", ")}). Use exactly one of "prompt", "runs", "foreach", or "workflow".`,
    );
  }

  if (raw.workflow != null) {
    if (!opts.allowWorkflowCalls) {
      throw new Error(
        `Step "${stepName}" uses "workflow", which is not supported in worktrees.yml setup_steps.`,
      );
    }
    return {
      kind: "workflow",
      name: stepName,
      workflow: parseWorkflowCall(raw.workflow),
      ...(condition ? { condition } : {}),
    } satisfies WorkflowCallStepDef;
  }

  if (raw.runs != null) {
    return {
      kind: "script",
      name: stepName,
      runs: raw.runs as string,
      ...(condition ? { condition } : {}),
    } satisfies ScriptStepDef;
  }

  if (raw.foreach != null) {
    const foreachExpr = String(raw.foreach);
    const parameter = parseForeachParameter(foreachExpr, raw.name);
    return {
      kind: "foreach",
      name: stepName,
      foreach: foreachExpr,
      parameter,
      steps: parseSteps(raw.steps as unknown[], opts),
      ...(condition ? { condition } : {}),
    } satisfies ForeachStepDef;
  }

  const step: PromptStepDef = {
    kind: "prompt",
    name: stepName,
    prompt: (raw.prompt as string) ?? "",
    ...(condition ? { condition } : {}),
  };

  if (raw.required_integrations != null) {
    step.required_integrations = parseRequiredIntegrations(raw.required_integrations, stepName);
  }

  if (raw.await_approval != null) {
    const aa = raw.await_approval as Record<string, unknown>;
    step.await_approval = {
      enabled: aa.enabled as string | boolean,
      ...(aa.attachments != null ? { attachments: aa.attachments as string[] } : {}),
    } satisfies AwaitApproval;
  }

  if (raw.branch != null) {
    step.branch = parseBranch(raw.branch as Record<string, unknown>[], opts);
  }

  return step;
}

function parseCondition(raw: unknown): StepCondition | undefined {
  if (raw == null) return undefined;
  const value = String(raw).trim();
  if (!value) return undefined;
  if (value === "success" || value === "failure" || value === "always") {
    return { outcome: value };
  }
  return {
    outcome: "success",
    ai_condition: value,
  };
}

function parseWorkflowCall(raw: unknown): WorkflowCallStepDef["workflow"] {
  const obj = raw as Record<string, unknown>;
  const inputsRaw = obj.inputs as Record<string, unknown> | undefined;
  const inputs = inputsRaw == null
    ? undefined
    : Object.fromEntries(
        Object.entries(inputsRaw).map(([key, value]) => [key, normalizeWorkflowInputValue(value)]),
      );
  return {
    name: (obj.name as string) ?? "",
    ...(inputs ? { inputs } : {}),
  };
}

function parseRequiredIntegrations(
  raw: unknown,
  stepName: string,
): RequiredIntegrations {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      `Step "${stepName}" has invalid "required_integrations". Expected a map like { github: {} }.`,
    );
  }

  const out: RequiredIntegrations = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value == null) {
      out[name] = {};
      continue;
    }

    if (typeof value !== "object" || Array.isArray(value)) {
      throw new Error(
        `Step "${stepName}" has invalid integration config for "${name}". Expected an object or empty value.`,
      );
    }

    const config = value as Record<string, unknown>;
    out[name] = {
      ...(Array.isArray(config.permissions)
        ? { permissions: config.permissions as RequiredIntegrations[string]["permissions"] }
        : {}),
    };
  }

  return out;
}

function normalizeWorkflowInputValue(value: unknown): string | boolean | number {
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 1 && entries[0][1] == null) {
      return `{${entries[0][0]}}`;
    }
  }

  throw new Error(
    `Workflow inputs must be strings, booleans, or numbers. Wrap freeform placeholder text in quotes if needed.`,
  );
}

function parseForeachParameter(
  expr: string,
  stepName: unknown,
): string {
  const match = expr.trim().match(/^([^\s]+)/);
  if (!match || !match[1]) {
    throw new Error(
      `Step "${String(stepName ?? "")}" has invalid "foreach" expression. Expected "<parameter> ...".`,
    );
  }
  return match[1].toLowerCase();
}

function parseBranch(
  rawBranches: Record<string, unknown>[],
  opts: { allowWorkflowCalls: boolean },
): BranchDef {
  let ifBranch: IfBranch | undefined;
  let elseBranch: ElseBranch | undefined;

  for (const b of rawBranches) {
    if ("else" in b) {
      elseBranch = { steps: parseSteps(b.steps as unknown[], opts) };
    } else if (b.if != null && !ifBranch) {
      ifBranch = {
        condition: b.if as string,
        steps: parseSteps(b.steps as unknown[], opts),
      };
    }
  }

  if (!ifBranch) {
    ifBranch = { condition: "", steps: [] };
  }
  if (!elseBranch) {
    elseBranch = { steps: [] };
  }

  return {
    if: ifBranch,
    else: elseBranch,
  };
}

function parseCleanupEvents(raw: unknown[]): CleanupEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((e) => {
    if (typeof e === "string") {
      return { [e]: undefined };
    }
    return e as CleanupEvent;
  });
}

// --- Validation ---

export function validateWorkflow(
  workflow: ParsedWorkflowDef | WorkflowDef,
  opts?: ValidateWorkflowOpts,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!workflow.name || typeof workflow.name !== "string") {
    errors.push({ path: "name", message: "Workflow name is required" });
  }

  if (!workflow.steps || !Array.isArray(workflow.steps) || workflow.steps.length === 0) {
    errors.push({ path: "steps", message: "Workflow must have at least one step" });
  } else {
    for (let i = 0; i < workflow.steps.length; i++) {
      errors.push(...validateStep(workflow.steps[i], `steps[${i}]`));
    }
  }

  errors.push(...validateTemplateExpressions(workflow, opts));

  if (workflow.worktree) {
    const validActions = ["create", "inherit"];
    if (!validActions.includes(workflow.worktree.action)) {
      errors.push({
        path: "worktree.action",
        message: `Invalid worktree action "${workflow.worktree.action}". Must be one of: ${validActions.join(", ")}`,
      });
    }
  }

  if (workflow.inputs) {
    for (const [key, input] of Object.entries(workflow.inputs)) {
      const validTypes = ["string", "boolean", "number"];
      if (!validTypes.includes(input.type)) {
        errors.push({
          path: `inputs.${key}.type`,
          message: `Invalid input type "${input.type}". Must be one of: ${validTypes.join(", ")}`,
        });
      }
    }
  }

  return errors;
}

function validateStep(step: ParsedWorkflowStepDef, pathName: string): ValidationError[] {
  const errors: ValidationError[] = [];

  validateCondition(step.condition, `${pathName}.if`, errors);

  switch (step.kind) {
    case "script": {
      if (!step.name) {
        errors.push({ path: pathName, message: "Script step must have a name" });
      }
      if (!step.runs) {
        errors.push({ path: pathName, message: "Script step must have a runs command" });
      }
      break;
    }
    case "foreach": {
      if (!step.name) {
        errors.push({ path: pathName, message: "Foreach step must have a name" });
      }
      if (!step.foreach) {
        errors.push({ path: pathName, message: "Foreach step must have a foreach expression" });
      }
      if (!step.parameter) {
        errors.push({ path: pathName, message: "Foreach step must define a parameter" });
      }
      if (!step.steps || step.steps.length === 0) {
        errors.push({ path: pathName, message: "Foreach step must have nested steps" });
      } else {
        for (let i = 0; i < step.steps.length; i++) {
          errors.push(...validateStep(step.steps[i], `${pathName}.steps[${i}]`));
        }
      }
      break;
    }
    case "workflow": {
      if (!step.name) {
        errors.push({ path: pathName, message: "Workflow step must have a name" });
      }
      if (!step.workflow.name) {
        errors.push({ path: `${pathName}.workflow.name`, message: "Workflow step must reference a workflow name" });
      }
      break;
    }
    case "prompt": {
      if (!step.name) {
        errors.push({ path: pathName, message: "Prompt step must have a name" });
      }
      if (!step.prompt && !step.branch) {
        errors.push({ path: pathName, message: "Prompt step must have a prompt or branch" });
      }
      if (step.required_integrations) {
        validateRequiredIntegrations(step.required_integrations, `${pathName}.required_integrations`, errors);
      }
      if (step.branch) {
        if (!step.branch.if.condition) {
          errors.push({
            path: `${pathName}.branch.if`,
            message: "Branch 'if' must have a condition",
          });
        }
        for (let j = 0; j < step.branch.if.steps.length; j++) {
          errors.push(...validateStep(step.branch.if.steps[j], `${pathName}.branch.if.steps[${j}]`));
        }
        for (let j = 0; j < step.branch.else.steps.length; j++) {
          errors.push(...validateStep(step.branch.else.steps[j], `${pathName}.branch.else.steps[${j}]`));
        }
      }
      break;
    }
  }

  return errors;
}

function validateRequiredIntegrations(
  requiredIntegrations: RequiredIntegrations,
  pathName: string,
  errors: ValidationError[],
): void {
  for (const [name, config] of Object.entries(requiredIntegrations)) {
    if (!name.trim()) {
      errors.push({
        path: pathName,
        message: "Integration names in required_integrations must not be empty",
      });
    }

    if (config.permissions != null && !Array.isArray(config.permissions)) {
      errors.push({
        path: `${pathName}.${name}.permissions`,
        message: "Integration permissions must be an array when provided",
      });
    }
  }
}

function validateCondition(
  condition: StepCondition | undefined,
  pathName: string,
  errors: ValidationError[],
): void {
  if (!condition) return;
  const validConditions = ["success", "failure", "always"];
  if (!validConditions.includes(condition.outcome)) {
    errors.push({
      path: pathName,
      message: `Invalid condition outcome "${condition.outcome}". Must be one of: ${validConditions.join(", ")}`,
    });
  }
  if (condition.ai_condition != null && !condition.ai_condition.trim()) {
    errors.push({
      path: pathName,
      message: "Freeform condition text must not be empty",
    });
  }
}

export function validateWorktreesConfig(config: WorktreesConfig): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!config.setup_steps || !Array.isArray(config.setup_steps)) {
    errors.push({ path: "setup_steps", message: "setup_steps is required and must be an array" });
  } else {
    for (let i = 0; i < config.setup_steps.length; i++) {
      errors.push(...validateStep(config.setup_steps[i], `setup_steps[${i}]`));
    }
  }

  if (!config.cleanup_on || !Array.isArray(config.cleanup_on)) {
    errors.push({ path: "cleanup_on", message: "cleanup_on is required and must be an array" });
  }

  return errors;
}

// --- Template expression validation ---

const VALID_NAMESPACES = new Set(["inputs", "artifacts", "output_artifacts", "skills", "workflows", "worktree_metadata", "zombieben", "worktree"]);
const TEMPLATE_EXPR_PATTERN = /\$\{\{\s*(\S+?)\s*\}\}/g;

function validateTemplateExpressions(
  workflow: ParsedWorkflowDef | WorkflowDef,
  opts?: ValidateWorkflowOpts,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const inputNames = new Set(workflow.inputs ? Object.keys(workflow.inputs) : []);
  const workflows = opts?.workflowsDir ? discoverWorkflowTemplateMap(opts.workflowsDir) : undefined;

  function checkExpr(expr: string, stepPath: string): void {
    const dot = expr.indexOf(".");
    if (dot === -1) return;
    const ns = expr.slice(0, dot);
    const key = expr.slice(dot + 1);

    if (!VALID_NAMESPACES.has(ns)) {
      errors.push({
        path: stepPath,
        message: `Unknown template namespace "${ns}" in expression "$\{{ ${expr} }}"`,
      });
      return;
    }

    if (ns === "inputs" && !inputNames.has(key)) {
      errors.push({
        path: stepPath,
        message: `Input "${key}" is referenced but not declared in workflow inputs`,
      });
    }

    if (ns === "skills" && opts?.repoDir) {
      const skillDirs = [
        path.join(opts.repoDir, ".zombieben", "skills"),
        path.join(opts.repoDir, ".agents", "skills"),
      ];
      const found = skillDirs.some((dir) => {
        if (!fs.existsSync(dir)) return false;
        try {
          const entries = fs.readdirSync(dir, { recursive: true }) as string[];
          return entries.some((e) => {
            const name = path.basename(String(e), path.extname(String(e)));
            return name === key;
          });
        } catch {
          return false;
        }
      });
      if (!found) {
        errors.push({
          path: stepPath,
          message: `Skill "${key}" is referenced but no matching skill file found`,
        });
      }
    }

    if (ns === "workflows" && workflows) {
      const workflowValue = getNestedValue(workflows, key);
      if (workflowValue == null) {
        errors.push({
          path: stepPath,
          message: `Workflow "${key}" is referenced but no matching workflow file was found`,
        });
      }
    }
  }

  function checkTemplate(template: string, stepPath: string): void {
    let match;
    const pattern = new RegExp(TEMPLATE_EXPR_PATTERN.source, "g");
    while ((match = pattern.exec(template)) !== null) {
      checkExpr(match[1], stepPath);
    }
  }

  function checkStep(step: ParsedWorkflowStepDef, stepPath: string): void {
    if (step.condition?.ai_condition) {
      checkTemplate(step.condition.ai_condition, stepPath);
    }

    if (step.kind === "prompt") {
      if (step.prompt) checkTemplate(step.prompt, stepPath);
      if (step.await_approval?.attachments) {
        for (const attachment of step.await_approval.attachments) {
          checkTemplate(attachment, stepPath);
        }
      }
      if (step.branch) {
        checkTemplate(step.branch.if.condition, `${stepPath}.branch.if`);
        for (let j = 0; j < step.branch.if.steps.length; j++) {
          checkStep(step.branch.if.steps[j], `${stepPath}.branch.if.steps[${j}]`);
        }
        for (let j = 0; j < step.branch.else.steps.length; j++) {
          checkStep(step.branch.else.steps[j], `${stepPath}.branch.else.steps[${j}]`);
        }
      }
      return;
    }

    if (step.kind === "foreach") {
      checkTemplate(step.foreach, stepPath);
      for (let j = 0; j < step.steps.length; j++) {
        checkStep(step.steps[j], `${stepPath}.steps[${j}]`);
      }
      return;
    }

    if (step.kind === "script") {
      checkTemplate(step.runs, stepPath);
      return;
    }

    if (step.workflow.inputs) {
      for (const [key, value] of Object.entries(step.workflow.inputs)) {
        if (typeof value === "string") {
          checkTemplate(value, `${stepPath}.workflow.inputs.${key}`);
        }
      }
    }
  }

  if (workflow.steps) {
    for (let i = 0; i < workflow.steps.length; i++) {
      checkStep(workflow.steps[i], `steps[${i}]`);
    }
  }

  return errors;
}

function getNestedValue(obj: Record<string, unknown>, dotPath: string): unknown {
  const parts = dotPath.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current == null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}
