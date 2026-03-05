import fs from "node:fs";
import { reposDir, worktreesDir, worktreeStatePath } from "@/util/paths.js";
import type { WorkflowRunState } from "./workflow-run-state.js";

export interface ActiveRun {
  repoSlug: string;
  worktreeId: string;
  state: WorkflowRunState;
  statePath: string;
}

/**
 * Scan all repos/worktrees for active workflow runs.
 */
export function scanActiveRuns(): ActiveRun[] {
  const results: ActiveRun[] = [];
  const repos = reposDir();

  if (!fs.existsSync(repos)) return results;

  for (const repoEntry of fs.readdirSync(repos, { withFileTypes: true })) {
    if (!repoEntry.isDirectory()) continue;
    const wtDir = worktreesDir(repoEntry.name);
    if (!fs.existsSync(wtDir)) continue;

    for (const wtEntry of fs.readdirSync(wtDir, { withFileTypes: true })) {
      if (!wtEntry.isDirectory()) continue;

      const stPath = worktreeStatePath(repoEntry.name, wtEntry.name);
      if (!fs.existsSync(stPath)) continue;

      try {
        const raw = JSON.parse(fs.readFileSync(stPath, "utf-8")) as WorkflowRunState;
        if (raw.status === "running") {
          results.push({
            repoSlug: repoEntry.name,
            worktreeId: wtEntry.name,
            state: raw,
            statePath: stPath,
          });
        }
      } catch {
        // Skip corrupted state files
      }
    }
  }

  return results;
}

/**
 * Scan all repos/worktrees for any workflow state (any status).
 */
export function scanAllRuns(): ActiveRun[] {
  const results: ActiveRun[] = [];
  const repos = reposDir();

  if (!fs.existsSync(repos)) return results;

  for (const repoEntry of fs.readdirSync(repos, { withFileTypes: true })) {
    if (!repoEntry.isDirectory()) continue;
    const wtDir = worktreesDir(repoEntry.name);
    if (!fs.existsSync(wtDir)) continue;

    for (const wtEntry of fs.readdirSync(wtDir, { withFileTypes: true })) {
      if (!wtEntry.isDirectory()) continue;

      const stPath = worktreeStatePath(repoEntry.name, wtEntry.name);
      if (!fs.existsSync(stPath)) continue;

      try {
        const raw = JSON.parse(fs.readFileSync(stPath, "utf-8")) as WorkflowRunState;
        results.push({
          repoSlug: repoEntry.name,
          worktreeId: wtEntry.name,
          state: raw,
          statePath: stPath,
        });
      } catch {
        // Skip corrupted state files
      }
    }
  }

  return results;
}
