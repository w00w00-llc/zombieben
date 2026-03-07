export type WorkflowRunStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "superseded";

export interface WorkflowRunState {
  workflow_name: string;
  workflow_file: string;
  status: WorkflowRunStatus;
  step_index: number;
  step_name: string;
  attempt: number;
  max_attempts: number;
  inputs: Record<string, unknown>;
  artifacts: Record<string, string>;
  created_at: string;
  updated_at: string;
  error?: string;
  pr_url?: string;
  superseded_by?: {
    repoSlug: string;
    worktreeId: string;
    runId: string;
  };
  supersede_reason?: string;
}
