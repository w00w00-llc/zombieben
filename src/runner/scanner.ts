import fs from "node:fs";
import { reposDir, worktreesDir, runsDir, runStatePath } from "@/util/paths.js";
import type { WorkflowRunState } from "@/engine/workflow-run-state.js";

export interface ActiveRun {
  repoSlug: string;
  worktreeId: string;
  runId: string;
  state: WorkflowRunState;
  statePath: string;
}

/**
 * Scan all repos/worktrees/runs for active workflow runs.
 */
export function scanActiveRuns(): ActiveRun[] {
  return scanRuns((state) => state.status === "running");
}

/**
 * Scan all repos/worktrees/runs for any workflow state (any status).
 */
export function scanAllRuns(): ActiveRun[] {
  return scanRuns(() => true);
}

function scanRuns(filter: (state: WorkflowRunState) => boolean): ActiveRun[] {
  const results: ActiveRun[] = [];
  const repos = reposDir();

  if (!fs.existsSync(repos)) return results;

  for (const repoEntry of fs.readdirSync(repos, { withFileTypes: true })) {
    if (!repoEntry.isDirectory()) continue;
    const wtDir = worktreesDir(repoEntry.name);
    if (!fs.existsSync(wtDir)) continue;

    for (const wtEntry of fs.readdirSync(wtDir, { withFileTypes: true })) {
      if (!wtEntry.isDirectory()) continue;

      const rDir = runsDir(repoEntry.name, wtEntry.name);
      if (!fs.existsSync(rDir)) continue;

      for (const runEntry of fs.readdirSync(rDir, { withFileTypes: true })) {
        if (!runEntry.isDirectory()) continue;

        const stPath = runStatePath(repoEntry.name, wtEntry.name, runEntry.name);
        if (!fs.existsSync(stPath)) continue;

        try {
          const raw = JSON.parse(fs.readFileSync(stPath, "utf-8")) as WorkflowRunState;
          if (filter(raw)) {
            results.push({
              repoSlug: repoEntry.name,
              worktreeId: wtEntry.name,
              runId: runEntry.name,
              state: raw,
              statePath: stPath,
            });
          }
        } catch {
          // Skip corrupted state files
        }
      }
    }
  }

  return results;
}
