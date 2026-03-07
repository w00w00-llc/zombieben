import type { TriggerResponder } from "@/responder/responder.js";
import type {
  TriageOutcome,
  InProgressWorkflowAdjustment,
  NewWorkflow,
} from "./types.js";

export interface PresentResult {
  shouldRun: boolean;
  resolution?: {
    repoSlug: string;
    workflowFile: string;
    workflowName: string;
    inputs: Record<string, string>;
    worktreeId?: string;
  };
}

function extractResolution(run: {
  repoSlug: string;
  workflowFile: string;
  workflowName: string;
  inputs: Record<string, string>;
  worktreeId?: string;
}): PresentResult["resolution"] {
  return {
    repoSlug: run.repoSlug,
    workflowFile: run.workflowFile,
    workflowName: run.workflowName,
    inputs: run.inputs,
    ...(run.worktreeId ? { worktreeId: run.worktreeId } : {}),
  };
}

export async function presentOutcome(
  outcome: TriageOutcome,
  responder: TriggerResponder,
): Promise<PresentResult> {
  switch (outcome.kind) {
    case "immediate_response":
      await responder.send(outcome.message);
      return { shouldRun: false };

    case "new_workflow":
      return presentNewWorkflow(outcome, responder);

    case "in_progress_workflow_adjustment":
      await presentAdjustment(outcome, responder);
      return { shouldRun: false };
  }
}

async function presentNewWorkflow(
  outcome: NewWorkflow,
  responder: TriggerResponder,
): Promise<PresentResult> {
  const { resolution } = outcome;

  switch (resolution.type) {
    case "run": {
      await responder.send(formatRunMessage(resolution));
      return { shouldRun: true, resolution: extractResolution(resolution) };
    }

    case "confirm": {
      const choice = await responder.promptChoice(
        resolution.confirmationPrompt,
        ["Yes, run it", "No, cancel"],
      );
      if (choice === 0) {
        await responder.send(formatRunMessage(resolution));
        return { shouldRun: true, resolution: extractResolution(resolution) };
      } else {
        await responder.send("Cancelled.");
        return { shouldRun: false };
      }
    }

    case "suggest": {
      const options = resolution.suggestions.map((s) => s.workflowName);
      const choice = await responder.promptChoice(resolution.prompt, options);
      const selected = resolution.suggestions[choice];
      await responder.send(formatRunMessage(selected));
      return { shouldRun: true, resolution: extractResolution(selected) };
    }
  }
}

function formatRunMessage(run: {
  workflowName: string;
  workflowFile: string;
  repoSlug: string;
  inputs: Record<string, string>;
}): string {
  const lines = [
    `Running *${run.workflowName}* (\`${run.workflowFile}\`) in \`${run.repoSlug}\``,
  ];

  const entries = Object.entries(run.inputs);
  if (entries.length > 0) {
    for (const [key, value] of entries) {
      lines.push(`> *${key}:* ${value}`);
    }
  }

  return lines.join("\n");
}

async function presentAdjustment(
  outcome: InProgressWorkflowAdjustment,
  responder: TriggerResponder,
): Promise<void> {
  const { repoSlug, worktreeId } = outcome.relatedRun;
  const { action } = outcome;

  switch (action.type) {
    case "status_check":
      await responder.send(
        `Checking status of *${worktreeId}* in \`${repoSlug}\`...`,
      );
      return;
    case "pause":
      await responder.send(
        `Pausing *${worktreeId}* in \`${repoSlug}\`.`,
      );
      return;
    case "resume":
      await responder.send(
        `Resuming *${worktreeId}* in \`${repoSlug}\`.`,
      );
      return;
    case "cancel":
      await responder.send(
        `Cancelling *${worktreeId}* in \`${repoSlug}\`.`,
      );
      return;
    case "adjust":
      await responder.send(
        `Adjusting *${worktreeId}* in \`${repoSlug}\`: ${action.instruction}`,
      );
      return;
    case "rollback_to_step":
      await responder.send(
        `Rolling back *${worktreeId}* in \`${repoSlug}\` to step ${action.stepIndex}.`,
      );
      return;
  }
}
