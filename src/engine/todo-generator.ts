import type { WorkflowStepDef, PromptStepDef } from "@/workflow/types/index.js";
import type { TemplateContext } from "@/workflow/template.js";
import { resolveTemplate } from "@/workflow/template.js";

/**
 * Render a workflow step into a TODO.md string that Claude can execute.
 * Only prompt steps and for-loop steps produce TODOs.
 */
export function renderStepTodo(
  step: WorkflowStepDef,
  context: TemplateContext,
  artifactsDir: string
): string {
  if (step.kind === "builtin") {
    return `# ${step.uses}\n\n(Handled by ZombieBen internally)`;
  }

  if (step.kind === "script") {
    return `# ${step.name}\n\n(Script step — handled by ZombieBen internally)`;
  }

  const sections: string[] = [];

  // Header
  sections.push(`# ${step.name || "Step"}`);

  if (step.kind === "prompt") {
    renderPromptStep(step, context, artifactsDir, sections);
  } else if (step.kind === "for") {
    sections.push(`Iterate: ${step.for}`);
    sections.push(
      `Sub-steps: ${step.steps.map((s) => ("name" in s ? s.name : s.kind)).join(", ")}`
    );
  }

  // Execution result instruction
  sections.push(
    `## Completion\n\n` +
      `When you are done, write a JSON file to \`${artifactsDir}/execution_result.json\` with this format:\n\n` +
      "```json\n" +
      '{\n  "success": true | false,\n  "summary": "Brief description of what was done",\n  "failures": ["list of failures if any"],\n  "artifacts": ["list of output file paths"]\n}\n' +
      "```"
  );

  return sections.join("\n\n");
}

function renderPromptStep(
  step: PromptStepDef,
  context: TemplateContext,
  _artifactsDir: string,
  sections: string[]
): void {
  if (step.prompt) {
    sections.push(resolveTemplate(step.prompt, context));
  }

  if (step.retry_policy?.retry_prompt) {
    sections.push(
      "## On Failure\n\n" +
        resolveTemplate(step.retry_policy.retry_prompt, context)
    );
  }
}
