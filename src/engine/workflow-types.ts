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
// Discriminated union: prompt steps, foreach steps, and script steps

export type WorkflowStepDef = PromptStepDef | ForeachStepDef | ScriptStepDef;

/** A step that runs a prompt via claude -p */
export interface PromptStepDef {
  kind: "prompt";
  name: string;
  prompt: string;
  if?: "success" | "failure" | "always";
  required_integrations?: RequiredIntegration[];
  await_approval?: AwaitApproval;
  branch?: BranchDef;
}

/** A step that iterates over a collection */
export interface ForeachStepDef {
  kind: "foreach";
  name: string;
  foreach: string;
  parameter: string;
  steps: WorkflowStepDef[];
  if?: "success" | "failure" | "always";
}

/** A step that runs a shell command */
export interface ScriptStepDef {
  kind: "script";
  name: string;
  runs: string;
  if?: "success" | "failure" | "always";
}

// --- Branch (if/else) ---

export interface BranchDef {
  if: IfBranch;
  else: ElseBranch;
}

export interface IfBranch {
  condition: string;
  steps: WorkflowStepDef[];
}

export interface ElseBranch {
  steps: WorkflowStepDef[];
}

// --- Shared step properties ---

export interface RequiredIntegration {
  [integration: string]: {
    permissions: (string | Record<string, string>)[];
  };
}

export interface AwaitApproval {
  enabled: string | boolean;
  attachments?: string[];
}
