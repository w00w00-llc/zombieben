// --- Worktrees config types ---
// Parsed from .zombieben/worktrees.yml

import type { WorkflowStepDef } from "./index.js";

export interface WorktreesConfig {
  setup_steps: WorkflowStepDef[];
  cleanup_on: CleanupEvent[];
}

export interface CleanupEvent {
  [event: string]: CleanupEventConfig | undefined;
}

export interface CleanupEventConfig {
  state?: string;
  [key: string]: unknown;
}
