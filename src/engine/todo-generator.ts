import type {
  WorkflowDef,
  WorkflowStepDef,
  PromptStepDef,
  ForLoopStepDef,
} from "./workflow-types.js";
import type { TemplateContext } from "./workflow-template.js";
import { resolveTemplate } from "./workflow-template.js";
import { shouldAwaitApprovalForPrompt } from "./await-approval.js";

/**
 * Render a workflow into a markdown checklist starting from `startIndex`.
 * This is the TODO that gets handed to the coding agent.
 */
export function createTodoMarkdown(
  workflow: WorkflowDef,
  context: TemplateContext,
  startIndex = 0,
): string {
  const lines: string[] = [];
  const failureLines: string[] = [];
  const worktreeSectionStart = workflow.worktree_setup_start_index;
  const worktreeSectionCount = workflow.worktree_setup_count ?? 0;
  const worktreeSectionEnd = worktreeSectionStart != null
    ? worktreeSectionStart + worktreeSectionCount - 1
    : undefined;
  const primarySectionStart = worktreeSectionEnd != null
    ? worktreeSectionEnd + 1
    : undefined;
  const startsInsideWorktreeSection =
    worktreeSectionStart != null
    && worktreeSectionEnd != null
    && startIndex >= worktreeSectionStart
    && startIndex <= worktreeSectionEnd;
  const startsInsidePrimarySection =
    primarySectionStart != null && startIndex >= primarySectionStart;

  for (let i = startIndex; i < workflow.steps.length; i++) {
    const shouldStartWorktreeSection =
      worktreeSectionStart != null && (
        (startsInsideWorktreeSection && i === startIndex)
        || (!startsInsideWorktreeSection && i === worktreeSectionStart)
      );

    if (shouldStartWorktreeSection) {
      lines.push("");
      lines.push("# Worktree Creation");
      lines.push("");
    }

    const shouldStartPrimarySection =
      primarySectionStart != null && (
        (startsInsidePrimarySection && i === startIndex)
        || (!startsInsidePrimarySection && i === primarySectionStart)
      );

    if (shouldStartPrimarySection) {
      lines.push("");
      lines.push("# Primary Tasks");
      lines.push("");
    }

    const step = workflow.steps[i];
    if (hasCondition(step, "failure")) {
      renderStep(step, context, failureLines, 0);
    } else if (hasCondition(step, "always")) {
      // "always" steps go in both sections
      renderStep(step, context, lines, 0);
      renderStep(step, context, failureLines, 0);
    } else {
      renderStep(step, context, lines, 0);
    }
  }

  if (failureLines.length > 0) {
    lines.push("");
    lines.push("# Failure Tasks");
    lines.push("");
    lines.push(...failureLines);
  }

  return lines.join("\n");
}

function hasCondition(
  step: WorkflowStepDef,
  condition: string,
): boolean {
  return step.if === condition;
}

function renderStep(
  step: WorkflowStepDef,
  context: TemplateContext,
  lines: string[],
  depth: number,
): void {
  const indent = "  ".repeat(depth);
  const checkbox = `${indent}- [ ] `;

  switch (step.kind) {
    case "script":
      lines.push(`${checkbox}Run: \`${step.runs}\``);
      break;

    case "prompt":
      renderPromptStep(step, context, lines, depth);
      break;

    case "for":
      renderForStep(step, context, lines, depth);
      break;
  }
}

function renderPromptStep(
  step: PromptStepDef,
  context: TemplateContext,
  lines: string[],
  depth: number,
): void {
  const indent = "  ".repeat(depth);
  const checkbox = `${indent}- [ ] `;
  const prompt = resolveTemplate(step.prompt, context).trim();

  if (step.branch) {
    // Branch step: render the prompt as the evaluation instruction,
    // then the branches as sub-steps with conditions
    const { branch } = step;
    const branchCondition = branch.if.condition;

    // The parent step asks the agent to evaluate and pick a branch
    const elseLabel = branch.else.steps.length > 0 ? "Otherwise" : "";
    lines.push(
      `${checkbox}${prompt}. If ${branchCondition}, mark "${elseLabel}" and all sub-steps as skipped, then continue with "${branchCondition}". Otherwise, mark "${branchCondition}" and all sub-steps as skipped, then continue with "${elseLabel}".`,
    );

    // If branch
    lines.push(`${indent}  - [ ] ${branchCondition}`);
    for (const sub of branch.if.steps) {
      renderStep(sub, context, lines, depth + 2);
    }

    // Else branch
    if (branch.else.steps.length > 0) {
      lines.push(`${indent}  - [ ] Otherwise`);
      for (const sub of branch.else.steps) {
        renderStep(sub, context, lines, depth + 2);
      }
    }
  } else {
    lines.push(`${checkbox}${prompt}`);
  }

  if (shouldAwaitApprovalForPrompt(step, context)) {
    const attachments = (step.await_approval?.attachments ?? [])
      .map((attachment) => resolveTemplate(attachment, context).trim())
      .filter(Boolean);
    const attachmentSummary = attachments.length > 0
      ? attachments.map((a) => `\`${a}\``).join(", ")
      : "(none)";
    lines.push(
      `${checkbox}AWAITING APPROVAL: Send a message to wait for approval, attaching these files: ${attachmentSummary}. Then exit without executing further TODO items.`,
    );
  }
}

function renderForStep(
  step: ForLoopStepDef,
  context: TemplateContext,
  lines: string[],
  depth: number,
): void {
  const indent = "  ".repeat(depth);
  const checkbox = `${indent}- [ ] `;

  const iterExpr = resolveTemplate(step.for, context).trim();
  lines.push(
    `${checkbox}Add TODO items below this for each: ${iterExpr}. Each iteration should contain the following sub-steps:`,
  );

  for (const sub of step.steps) {
    renderStep(sub, context, lines, depth + 1);
  }
}
