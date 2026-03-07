import fs from "node:fs";
import type { TriageOutcome, InProgressWorkflowAdjustment } from "./types.js";
import type { WorkflowRunState } from "@/engine/workflow-run-state.js";
import { runStatePath } from "@/util/paths.js";
import { log } from "@/util/logger.js";

interface RunRef {
  repoSlug: string;
  worktreeId: string;
  runId: string;
}

/**
 * Apply side effects for a triage outcome (state mutations).
 * This is separate from `presentOutcome` which handles messaging.
 */
export function applyOutcome(outcome: TriageOutcome): void {
  if (outcome.kind !== "in_progress_workflow_adjustment") return;
  applyAdjustment(outcome);
}

function applyAdjustment(outcome: InProgressWorkflowAdjustment): void {
  const { repoSlug, worktreeId, runId } = outcome.relatedRun;
  const statePath = runStatePath(repoSlug, worktreeId, runId);

  let state: WorkflowRunState;
  try {
    state = JSON.parse(fs.readFileSync(statePath, "utf-8")) as WorkflowRunState;
  } catch {
    log.error(`Cannot read run state at ${statePath}`);
    return;
  }

  switch (outcome.action.type) {
    case "resume": {
      if (state.status !== "awaiting_approval") {
        log.warn(
          `Cannot resume ${repoSlug}/${worktreeId}/${runId}: status is "${state.status}", not "awaiting_approval"`,
        );
        return;
      }
      state.status = "running";
      state.updated_at = new Date().toISOString();
      break;
    }

    case "cancel": {
      state.status = "failed";
      state.error = "Cancelled by user";
      state.updated_at = new Date().toISOString();
      break;
    }

    case "pause": {
      if (state.status !== "running") {
        log.warn(
          `Cannot pause ${repoSlug}/${worktreeId}/${runId}: status is "${state.status}", not "running"`,
        );
        return;
      }
      state.status = "awaiting_approval";
      state.updated_at = new Date().toISOString();
      break;
    }

    case "status_check":
    case "adjust":
    case "retry_fresh":
    case "rollback_to_step":
      // These don't have state mutations implemented yet
      return;
  }

  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  log.info(
    `Applied "${outcome.action.type}" to ${repoSlug}/${worktreeId}/${runId} → status: ${state.status}`,
  );
}

export function markRunSuperseded(
  relatedRun: RunRef,
  supersededBy: RunRef,
  reason = "Superseded by retry",
): void {
  const statePath = runStatePath(
    relatedRun.repoSlug,
    relatedRun.worktreeId,
    relatedRun.runId,
  );

  let state: WorkflowRunState;
  try {
    state = JSON.parse(fs.readFileSync(statePath, "utf-8")) as WorkflowRunState;
  } catch {
    log.error(`Cannot read run state at ${statePath}`);
    return;
  }

  state.status = "superseded";
  state.updated_at = new Date().toISOString();
  state.error = reason;
  state.supersede_reason = reason;
  state.superseded_by = {
    repoSlug: supersededBy.repoSlug,
    worktreeId: supersededBy.worktreeId,
    runId: supersededBy.runId,
  };

  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  log.info(
    `Marked ${relatedRun.repoSlug}/${relatedRun.worktreeId}/${relatedRun.runId} as superseded by ${supersededBy.repoSlug}/${supersededBy.worktreeId}/${supersededBy.runId}`,
  );
}
