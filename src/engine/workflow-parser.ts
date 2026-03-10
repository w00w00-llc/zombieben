import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type {
  WorkflowDef,
  WorkflowStepDef,
  PromptStepDef,
  ForeachStepDef,
  ScriptStepDef,
  WorktreeConfig,
  WorkflowInput,
  AwaitApproval,
  BranchDef,
  IfBranch,
  ElseBranch,
} from "./workflow-types.js";
import type {
  WorktreesConfig,
  CleanupEvent,
} from "./worktrees-config.js";

// --- Validation ---

export interface ValidationError {
  path: string;
  message: string;
}

// --- Parsing ---

export function parseWorkflow(yamlContent: string): WorkflowDef {
  const raw = yaml.load(yamlContent) as Record<string, unknown>;
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid workflow YAML: expected an object");
  }

  return {
    name: raw.name as string,
    ...(raw.confirmation_required === true ? { confirmation_required: true } : {}),
    worktree: raw.worktree ? parseWorktreeConfig(raw.worktree) : undefined,
    inputs: raw.inputs ? parseInputs(raw.inputs as Record<string, unknown>) : undefined,
    steps: parseSteps(raw.steps as unknown[]),
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

function parseSteps(raw: unknown[]): WorkflowStepDef[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => parseStep(s as Record<string, unknown>));
}

function parseStep(raw: Record<string, unknown>): WorkflowStepDef {
  // Script step: has `runs` field
  if (raw.runs != null) {
    return {
      kind: "script",
      name: (raw.name as string) ?? "",
      runs: raw.runs as string,
      ...(raw.if != null ? { if: raw.if as ScriptStepDef["if"] } : {}),
    } satisfies ScriptStepDef;
  }

  // Foreach step: has `foreach` field
  if (raw.foreach != null) {
    if (raw.prompt != null) {
      throw new Error(
        `Step "${raw.name ?? ""}" has both "foreach" and "prompt". Use "foreach" with "steps" instead.`,
      );
    }
    const foreachExpr = String(raw.foreach);
    const parameter = parseForeachParameter(foreachExpr, raw.name);
    return {
      kind: "foreach",
      name: (raw.name as string) ?? "",
      foreach: foreachExpr,
      parameter,
      steps: parseSteps(raw.steps as unknown[]),
      ...(raw.if != null ? { if: raw.if as ForeachStepDef["if"] } : {}),
    } satisfies ForeachStepDef;
  }

  // Prompt step (default)
  const step: PromptStepDef = {
    kind: "prompt",
    name: (raw.name as string) ?? "",
    prompt: (raw.prompt as string) ?? "",
  };

  if (raw.if != null) step.if = raw.if as PromptStepDef["if"];

  if (raw.required_integrations != null) {
    step.required_integrations = raw.required_integrations as PromptStepDef["required_integrations"];
  }

  if (raw.await_approval != null) {
    const aa = raw.await_approval as Record<string, unknown>;
    step.await_approval = {
      enabled: aa.enabled as string | boolean,
      ...(aa.attachments != null ? { attachments: aa.attachments as string[] } : {}),
    } satisfies AwaitApproval;
  }

  if (raw.branch != null) {
    step.branch = parseBranch(raw.branch as Record<string, unknown>[]);
  }

  return step;
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

function parseBranch(rawBranches: Record<string, unknown>[]): BranchDef {
  let ifBranch: IfBranch | undefined;
  let elseBranch: ElseBranch | undefined;

  for (const b of rawBranches) {
    if ("else" in b) {
      elseBranch = { steps: parseSteps(b.steps as unknown[]) };
    } else if (b.if != null && !ifBranch) {
      ifBranch = {
        condition: b.if as string,
        steps: parseSteps(b.steps as unknown[]),
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

// --- Worktrees config parsing ---

export function parseWorktreesConfig(yamlContent: string): WorktreesConfig {
  const raw = yaml.load(yamlContent) as Record<string, unknown>;
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid worktrees YAML: expected an object");
  }

  return {
    setup_steps: parseSteps(raw.setup_steps as unknown[]),
    cleanup_on: parseCleanupEvents(raw.cleanup_on as unknown[]),
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

export interface ValidateWorkflowOpts {
  repoDir?: string;
}

export function validateWorkflow(workflow: WorkflowDef, opts?: ValidateWorkflowOpts): ValidationError[] {
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

function validateStep(step: WorkflowStepDef, path: string): ValidationError[] {
  const errors: ValidationError[] = [];

  switch (step.kind) {
    case "script": {
      if (!step.name) {
        errors.push({ path, message: "Script step must have a name" });
      }
      if (!step.runs) {
        errors.push({ path, message: "Script step must have a runs command" });
      }
      if (step.if) {
        const validConditions = ["success", "failure", "always"];
        if (!validConditions.includes(step.if)) {
          errors.push({
            path: `${path}.if`,
            message: `Invalid condition "${step.if}". Must be one of: ${validConditions.join(", ")}`,
          });
        }
      }
      break;
    }
    case "foreach": {
      if (!step.name) {
        errors.push({ path, message: "Foreach step must have a name" });
      }
      if (!step.foreach) {
        errors.push({ path, message: "Foreach step must have a foreach expression" });
      }
      if (!step.parameter) {
        errors.push({ path, message: "Foreach step must define a parameter" });
      }
      if (!step.steps || step.steps.length === 0) {
        errors.push({ path, message: "Foreach step must have nested steps" });
      } else {
        for (let i = 0; i < step.steps.length; i++) {
          errors.push(...validateStep(step.steps[i], `${path}.steps[${i}]`));
        }
      }
      break;
    }
    case "prompt": {
      if (!step.name) {
        errors.push({ path, message: "Prompt step must have a name" });
      }
      if (!step.prompt && !step.branch) {
        errors.push({ path, message: "Prompt step must have a prompt or branch" });
      }
      if (step.if) {
        const validConditions = ["success", "failure", "always"];
        if (!validConditions.includes(step.if)) {
          errors.push({
            path: `${path}.if`,
            message: `Invalid condition "${step.if}". Must be one of: ${validConditions.join(", ")}`,
          });
        }
      }
      if (step.branch) {
        if (!step.branch.if.condition) {
          errors.push({
            path: `${path}.branch.if`,
            message: "Branch 'if' must have a condition",
          });
        }
        // Validate if branch steps
        for (let j = 0; j < step.branch.if.steps.length; j++) {
          errors.push(...validateStep(step.branch.if.steps[j], `${path}.branch.if.steps[${j}]`));
        }
        // Validate else branch steps
        for (let j = 0; j < step.branch.else.steps.length; j++) {
          errors.push(...validateStep(step.branch.else.steps[j], `${path}.branch.else.steps[${j}]`));
        }
      }
      break;
    }
  }

  return errors;
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

const VALID_NAMESPACES = new Set(["inputs", "artifacts", "output_artifacts", "skills", "zombieben", "worktree"]);
const TEMPLATE_EXPR_PATTERN = /\$\{\{\s*(\S+?)\s*\}\}/g;

function validateTemplateExpressions(workflow: WorkflowDef, opts?: ValidateWorkflowOpts): ValidationError[] {
  const errors: ValidationError[] = [];
  const inputNames = new Set(workflow.inputs ? Object.keys(workflow.inputs) : []);

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
        } catch { return false; }
      });
      if (!found) {
        errors.push({
          path: stepPath,
          message: `Skill "${key}" is referenced but no matching skill file found`,
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

  function checkStep(step: WorkflowStepDef, stepPath: string): void {
    if (step.kind === "prompt") {
      if (step.prompt) checkTemplate(step.prompt, stepPath);
      if (step.await_approval?.attachments) {
        for (const a of step.await_approval.attachments) {
          checkTemplate(a, stepPath);
        }
      }
      if (step.branch) {
        for (let j = 0; j < step.branch.if.steps.length; j++) {
          checkStep(step.branch.if.steps[j], `${stepPath}.branch.if.steps[${j}]`);
        }
        for (let j = 0; j < step.branch.else.steps.length; j++) {
          checkStep(step.branch.else.steps[j], `${stepPath}.branch.else.steps[${j}]`);
        }
      }
    } else if (step.kind === "foreach") {
      for (let j = 0; j < step.steps.length; j++) {
        checkStep(step.steps[j], `${stepPath}.steps[${j}]`);
      }
    } else if (step.kind === "script") {
      checkTemplate(step.runs, stepPath);
    }
  }

  if (workflow.steps) {
    for (let i = 0; i < workflow.steps.length; i++) {
      checkStep(workflow.steps[i], `steps[${i}]`);
    }
  }

  return errors;
}
