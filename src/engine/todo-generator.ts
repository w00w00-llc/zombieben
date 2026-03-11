import type {
  WorkflowDef,
  WorkflowStepDef,
  PromptStepDef,
  ForeachStepDef,
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
  return step.condition?.outcome === condition;
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
      lines.push(formatStepText(`Run: \`${step.runs}\``, step, checkbox));
      break;

    case "prompt":
      renderPromptStep(step, context, lines, depth);
      break;

    case "foreach":
      renderForeachStep(step, context, lines, depth);
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
    lines.push(formatStepText(
      `${prompt}. If ${branchCondition}, mark "${elseLabel}" and all sub-steps as skipped, then continue with "${branchCondition}". Otherwise, mark "${branchCondition}" and all sub-steps as skipped, then continue with "${elseLabel}".`,
      step,
      checkbox,
    ));

    // If branch
    lines.push(`${indent}  - [ ] ${branchCondition}`);
    for (const sub of branch.if.steps as WorkflowStepDef[]) {
      renderStep(sub, context, lines, depth + 2);
    }

    // Else branch
    if (branch.else.steps.length > 0) {
      lines.push(`${indent}  - [ ] Otherwise`);
      for (const sub of branch.else.steps as WorkflowStepDef[]) {
        renderStep(sub, context, lines, depth + 2);
      }
    }
  } else {
    lines.push(formatStepText(prompt, step, checkbox));
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

function renderForeachStep(
  step: ForeachStepDef,
  context: TemplateContext,
  lines: string[],
  depth: number,
): void {
  const indent = "  ".repeat(depth);
  const checkbox = `${indent}- [ ] `;
  const iterExpr = resolveTemplate(step.foreach, context).trim();
  const remainder = iterExpr.split(/\s+/).slice(1).join(" ").trim();
  const iterationSource = remainder ? ` ${remainder}` : "";
  const itemTemplates = summarizeForeachItemTemplates(step, context);

  if (itemTemplates.length === 1) {
    lines.push(
      formatStepText(
        `For each ${step.parameter}${iterationSource}, add a TODO below this item with the contents: "${itemTemplates[0]}"`,
        step,
        checkbox,
      ),
    );
    return;
  }

  lines.push(
    formatStepText(
      `For each ${step.parameter}${iterationSource}, add TODO items below this item using this template:`,
      step,
      checkbox,
    ),
  );
  for (let i = 0; i < itemTemplates.length; i++) {
    lines.push(`${indent}  ${i + 1}. ${itemTemplates[i]}`);
  }
}

function formatStepText(
  text: string,
  step: WorkflowStepDef,
  checkbox: string,
): string {
  if (!step.condition?.ai_condition) {
    return `${checkbox}${text}`;
  }

  return `${checkbox}Only do this if ${step.condition.ai_condition}: ${text}. Otherwise, mark this item as skipped and continue.`;
}

function summarizeForeachItemTemplates(
  step: ForeachStepDef,
  context: TemplateContext,
): string[] {
  if (step.steps.length === 1 && step.steps[0].kind === "prompt") {
    return [resolveTemplate(step.steps[0].prompt, context).trim().replace(/\s+/g, " ")];
  }
  return step.steps.map((substep) => summarizeForeachTemplateStep(substep as WorkflowStepDef, context));
}

function summarizeForeachTemplateStep(
  step: WorkflowStepDef,
  context: TemplateContext,
): string {
  const conditionPrefix = summarizeConditionPrefix(step);

  switch (step.kind) {
    case "prompt": {
      const prompt = resolveTemplate(step.prompt, context).trim().replace(/\s+/g, " ");
      return `${conditionPrefix}${summarizeNamedTemplate(step.name, prompt)}`;
    }
    case "script": {
      return `${conditionPrefix}${summarizeNamedTemplate(step.name, `Run \`${step.runs}\``)}`;
    }
    case "foreach": {
      const iterExpr = resolveTemplate(step.foreach, context).trim();
      const nestedTemplates = summarizeForeachItemTemplates(step, context).join("; ");
      return `${conditionPrefix}${summarizeNamedTemplate(step.name, `For each ${iterExpr}: ${nestedTemplates}`)}`;
    }
  }
}

function summarizeConditionPrefix(step: WorkflowStepDef): string {
  if (!step.condition) return "";

  const prefixes: string[] = [];
  if (step.condition.outcome === "failure") prefixes.push("If prior steps failed");
  if (step.condition.outcome === "always") prefixes.push("Always");
  if (step.condition.ai_condition) prefixes.push(`Only if ${step.condition.ai_condition}`);
  if (prefixes.length === 0) return "";
  return `${prefixes.join("; ")}: `;
}

function summarizeNamedTemplate(name: string, body: string): string {
  return name ? `${name}: ${body}` : body;
}
