import yaml from "js-yaml";
import type {
  WorkflowDef,
  WorkflowStepDef,
  PromptStepDef,
  ForLoopStepDef,
  BuiltinStepDef,
  ScriptStepDef,
  WorkflowTriggers,
  WorktreeConfig,
  WorkflowInput,
  RetryPolicy,
  AwaitApproval,
  BranchDef,
  IfBranch,
  ElseIfBranch,
  ElseBranch,
} from "./types/index.js";
import type {
  WorktreesConfig,
  CleanupEvent,
} from "./types/worktrees-config.js";

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
    triggers: raw.triggers ? parseTriggers(raw.triggers) : undefined,
    worktree: raw.worktree ? parseWorktreeConfig(raw.worktree) : undefined,
    inputs: raw.inputs ? parseInputs(raw.inputs as Record<string, unknown>) : undefined,
    steps: parseSteps(raw.steps as unknown[]),
  };
}

function parseTriggers(raw: unknown): WorkflowTriggers {
  const obj = raw as Record<string, unknown>;
  const triggers: WorkflowTriggers = {};

  for (const [key, value] of Object.entries(obj)) {
    (triggers as Record<string, unknown>)[key] = value;
  }
  return triggers;
}

function parseWorktreeConfig(raw: unknown): WorktreeConfig {
  const obj = raw as Record<string, unknown>;
  return {
    action: obj.action as WorktreeConfig["action"],
    ...(obj.key_on != null ? { key_on: obj.key_on as string[] } : {}),
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
      ...(obj.autosynthesize != null ? { autosynthesize: obj.autosynthesize as boolean } : {}),
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

  // Builtin step: has `uses` field
  if (raw.uses != null) {
    return {
      kind: "builtin",
      uses: raw.uses as string,
    } satisfies BuiltinStepDef;
  }

  // For-loop step: has `for` field
  if (raw.for != null) {
    return {
      kind: "for",
      name: (raw.name as string) ?? "",
      for: raw.for as string,
      steps: parseSteps(raw.steps as unknown[]),
      ...(raw.failure_policy != null
        ? { failure_policy: raw.failure_policy as ForLoopStepDef["failure_policy"] }
        : {}),
      ...(raw.if != null ? { if: raw.if as ForLoopStepDef["if"] } : {}),
    } satisfies ForLoopStepDef;
  }

  // Prompt step (default)
  const step: PromptStepDef = {
    kind: "prompt",
    name: (raw.name as string) ?? "",
    prompt: (raw.prompt as string) ?? "",
  };

  if (raw.if != null) step.if = raw.if as PromptStepDef["if"];

  if (raw.retry_policy != null) {
    const rp = raw.retry_policy as Record<string, unknown>;
    step.retry_policy = {
      max_attempts: rp.max_attempts as number,
      ...(rp.retry_prompt != null ? { retry_prompt: rp.retry_prompt as string } : {}),
    } satisfies RetryPolicy;
  }

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

function parseBranch(rawBranches: Record<string, unknown>[]): BranchDef {
  let ifBranch: IfBranch | undefined;
  const elseifBranches: ElseIfBranch[] = [];
  let elseBranch: ElseBranch | undefined;

  for (const b of rawBranches) {
    if ("else" in b) {
      elseBranch = { steps: parseSteps(b.steps as unknown[]) };
    } else if (b.if != null && !ifBranch) {
      ifBranch = {
        condition: b.if as string,
        steps: parseSteps(b.steps as unknown[]),
      };
    } else if (b.if != null) {
      // Subsequent "if" entries become elseif
      elseifBranches.push({
        condition: b.if as string,
        steps: parseSteps(b.steps as unknown[]),
      });
    }
  }

  // Ensure we have at least an if and else
  if (!ifBranch) {
    ifBranch = { condition: "", steps: [] };
  }
  if (!elseBranch) {
    elseBranch = { steps: [] };
  }

  return {
    if: ifBranch,
    ...(elseifBranches.length > 0 ? { elseif: elseifBranches } : {}),
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

export function validateWorkflow(workflow: WorkflowDef): ValidationError[] {
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

  if (workflow.worktree) {
    const validActions = ["create", "inherit"];
    if (!validActions.includes(workflow.worktree.action)) {
      errors.push({
        path: "worktree.action",
        message: `Invalid worktree action "${workflow.worktree.action}". Must be one of: ${validActions.join(", ")}`,
      });
    }
    if (workflow.worktree.action === "inherit" && (!workflow.worktree.parents || workflow.worktree.parents.length === 0)) {
      errors.push({
        path: "worktree.parents",
        message: "Worktree action 'inherit' requires at least one parent workflow",
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
    case "builtin": {
      if (!step.uses) {
        errors.push({ path, message: "Builtin step must have a uses field" });
      }
      break;
    }
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
    case "for": {
      if (!step.name) {
        errors.push({ path, message: "For-loop step must have a name" });
      }
      if (!step.for) {
        errors.push({ path, message: "For-loop step must have a for expression" });
      }
      if (!step.steps || step.steps.length === 0) {
        errors.push({ path, message: "For-loop step must have nested steps" });
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
      if (step.retry_policy) {
        if (typeof step.retry_policy.max_attempts !== "number" || step.retry_policy.max_attempts < 1) {
          errors.push({
            path: `${path}.retry_policy.max_attempts`,
            message: "max_attempts must be a positive number",
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
        // Validate elseif branch steps
        if (step.branch.elseif) {
          for (let k = 0; k < step.branch.elseif.length; k++) {
            const eib = step.branch.elseif[k];
            if (!eib.condition) {
              errors.push({
                path: `${path}.branch.elseif[${k}]`,
                message: "Branch 'elseif' must have a condition",
              });
            }
            for (let j = 0; j < eib.steps.length; j++) {
              errors.push(...validateStep(eib.steps[j], `${path}.branch.elseif[${k}].steps[${j}]`));
            }
          }
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
