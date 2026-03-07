import type { TriageOutcome } from "@/triage/types.js";

function renderInputs(
  lines: string[],
  inputs: Record<string, string>,
  indent = "",
): void {
  lines.push(`${indent}Inputs:`);
  const entries = Object.entries(inputs);
  if (entries.length === 0) {
    lines.push(`${indent}- (none)`);
    return;
  }
  for (const [key, value] of entries) {
    lines.push(`${indent}- *${key}:* ${value}`);
  }
}

export function formatSlackOutcomeText(outcome: TriageOutcome): string {
  const lines: string[] = [];

  switch (outcome.kind) {
    case "immediate_response":
      lines.push("Triage: immediate_response");
      lines.push(outcome.message);
      return lines.join("\n");

    case "new_workflow": {
      const { resolution } = outcome;
      lines.push(`Triage: new_workflow/${resolution.type}`);

      if (resolution.type === "run") {
        lines.push(
          `Workflow: *${resolution.workflowName}* (\`${resolution.workflowFile}\`) in \`${resolution.repoSlug}\``,
        );
        renderInputs(lines, resolution.inputs);
      } else if (resolution.type === "confirm") {
        lines.push(
          `Please confirm running *${resolution.workflowName}* (\`${resolution.workflowFile}\`) in \`${resolution.repoSlug}\`.`,
        );
        renderInputs(lines, resolution.inputs);
      } else {
        lines.push(resolution.prompt);
        for (const s of resolution.suggestions) {
          lines.push(`- *${s.workflowName}*: ${s.description}`);
          renderInputs(lines, s.inputs, "  ");
        }
      }
      break;
    }

    case "in_progress_workflow_adjustment": {
      const { action, relatedRun } = outcome;
      lines.push(`Triage: in_progress_workflow_adjustment/${action.type}`);

      switch (action.type) {
        case "status_check":
          lines.push(`Checking status of *${relatedRun.worktreeId}* in \`${relatedRun.repoSlug}\`.`);
          break;
        case "pause":
          lines.push(`Pausing *${relatedRun.worktreeId}* in \`${relatedRun.repoSlug}\`.`);
          break;
        case "resume":
          lines.push(`Resuming *${relatedRun.worktreeId}* in \`${relatedRun.repoSlug}\`.`);
          break;
        case "cancel":
          lines.push(`Cancelling *${relatedRun.worktreeId}* in \`${relatedRun.repoSlug}\`.`);
          break;
        case "adjust":
          lines.push(`Adjusting *${relatedRun.worktreeId}* in \`${relatedRun.repoSlug}\`: ${action.instruction}`);
          break;
        case "rollback_to_step":
          lines.push(`Rolling back *${relatedRun.worktreeId}* in \`${relatedRun.repoSlug}\` to step ${action.stepIndex}.`);
          break;
        case "retry_fresh":
          lines.push(`Retrying failed run *${relatedRun.runId}* as a fresh run.`);
          break;
      }
      break;
    }
  }

  return lines.join("\n");
}
