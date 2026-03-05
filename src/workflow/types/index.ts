// --- Workflow definition types ---
// Parsed from .zombieben/workflows/*.yml

export interface WorkflowDef {
  name: string;
  triggers?: WorkflowTriggers;
  worktree?: WorktreeConfig;
  inputs?: Record<string, WorkflowInput>;
  steps: WorkflowStepDef[];
}

// --- Triggers ---

export interface WorkflowTriggers {
  slack?: unknown[];
  github?: unknown[];
  [key: string]: unknown[] | undefined;
}

// --- Worktree config (per-workflow) ---

export interface WorktreeConfig {
  action: "create" | "inherit";
  key_on?: string[];
  parents?: string[];
}

// --- Inputs ---

export interface WorkflowInput {
  description: string;
  required: boolean;
  type: "string" | "boolean" | "number";
  default?: string | boolean | number;
  autosynthesize?: boolean;
}

// --- Steps ---
// Discriminated union: prompt steps, for-loop steps, and builtin steps

export type WorkflowStepDef = PromptStepDef | ForLoopStepDef | BuiltinStepDef | ScriptStepDef;

/** A step that runs a prompt via claude -p */
export interface PromptStepDef {
  kind: "prompt";
  name: string;
  prompt: string;
  if?: "success" | "failure" | "always";
  retry_policy?: RetryPolicy;
  required_integrations?: RequiredIntegration[];
  await_approval?: AwaitApproval;
  branch?: BranchDef;
}

/** A step that iterates over a collection */
export interface ForLoopStepDef {
  kind: "for";
  name: string;
  for: string;
  steps: WorkflowStepDef[];
  failure_policy?: "continue" | "abort";
  if?: "success" | "failure" | "always";
}

/** A step that invokes a zombieben builtin (e.g. zombieben.create_worktree) */
export interface BuiltinStepDef {
  kind: "builtin";
  uses: string;
}

/** A step that runs a shell command */
export interface ScriptStepDef {
  kind: "script";
  name: string;
  runs: string;
  if?: "success" | "failure" | "always";
}

// --- Branch (if/elseif/else) ---

export interface BranchDef {
  if: IfBranch;
  elseif?: ElseIfBranch[];
  else: ElseBranch;
}

export interface IfBranch {
  condition: string;
  steps: WorkflowStepDef[];
}

export interface ElseIfBranch {
  condition: string;
  steps: WorkflowStepDef[];
}

export interface ElseBranch {
  steps: WorkflowStepDef[];
}

// --- Shared step properties ---

export interface RetryPolicy {
  max_attempts: number;
  retry_prompt?: string;
}

export interface RequiredIntegration {
  [integration: string]: {
    permissions: (string | Record<string, string>)[];
  };
}

export interface AwaitApproval {
  enabled: string | boolean;
  attachments?: string[];
}
