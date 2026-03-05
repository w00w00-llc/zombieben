import type { WorkflowRunState } from "./workflow-run-state.js";

export interface WorktreeState {
  repo_slug: string;
  worktree_id: string;
  branch: string;
  path: string;
  workflow_runs: WorkflowRunState[];
  created_at: string;
}
