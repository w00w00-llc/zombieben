// --- Workflow definition types ---
// Parsed from .zombieben/workflows/*.yml

export interface WorkflowDef {
  name: string;
  confirmation_required?: boolean;
  worktree?: WorktreeConfig;
  inputs?: Record<string, WorkflowInput>;
  steps: WorkflowStepDef[];
  // Runtime metadata: index where appended worktree setup steps begin.
  worktree_setup_start_index?: number;
  // Runtime metadata: number of worktree setup steps.
  worktree_setup_count?: number;
}

// --- Worktree config (per-workflow) ---

export interface WorktreeConfig {
  action: "create" | "inherit";
  parents?: string[];
}

// --- Inputs ---

export interface WorkflowInput {
  description: string;
  required: boolean;
  type: "string" | "boolean" | "number";
  default?: string | boolean | number;
}

// --- Steps ---
// Parsed workflows may also contain nested workflow call steps before expansion.

export type StepOutcomeCondition = "success" | "failure" | "always";

export interface StepCondition {
  outcome: StepOutcomeCondition;
  ai_condition?: string;
}

export interface BaseStepDef {
  name: string;
  condition?: StepCondition;
}

export type WorkflowStepDef = PromptStepDef | ForeachStepDef | ScriptStepDef;
export type ParsedWorkflowStepDef = WorkflowStepDef | WorkflowCallStepDef;

export interface ParsedWorkflowDef extends Omit<WorkflowDef, "steps"> {
  steps: ParsedWorkflowStepDef[];
}

/** A step that runs a prompt via claude -p */
export interface PromptStepDef extends BaseStepDef {
  kind: "prompt";
  prompt: string;
  required_integrations?: RequiredIntegrations;
  await_approval?: AwaitApproval;
  branch?: BranchDef;
}

/** A step that iterates over a collection */
export interface ForeachStepDef extends BaseStepDef {
  kind: "foreach";
  foreach: string;
  parameter: string;
  steps: ParsedWorkflowStepDef[];
}

/** A step that runs a shell command */
export interface ScriptStepDef extends BaseStepDef {
  kind: "script";
  runs: string;
}

/** A parsed step that injects another workflow */
export interface WorkflowCallStepDef extends BaseStepDef {
  kind: "workflow";
  workflow: {
    name: string;
    inputs?: Record<string, string | boolean | number>;
  };
}

// --- Branch (if/else) ---

export interface BranchDef {
  if: IfBranch;
  else: ElseBranch;
}

export interface IfBranch {
  condition: string;
  steps: ParsedWorkflowStepDef[];
}

export interface ElseBranch {
  steps: ParsedWorkflowStepDef[];
}

// --- Shared step properties ---

export interface RequiredIntegrationConfig {
  permissions?: (string | Record<string, string>)[];
}

export type RequiredIntegrations = Record<string, RequiredIntegrationConfig>;

export interface AwaitApproval {
  enabled: string | boolean;
  attachments?: string[];
}
