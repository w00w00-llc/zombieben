import { describe, it, expect } from "vitest";
import { createTodoMarkdown } from "./todo-generator.js";
import type { WorkflowDef } from "./workflow-types.js";
import type { TemplateContext } from "./workflow-template.js";

const context: TemplateContext = {
  inputs: {},
  artifacts: { plan: "/tmp/plan.md" },
  skills: {},
  worktree: { id: "wt-1", path: "/tmp/wt-1" },
  zombieben: { repo_slug: "org--repo", trigger: "/tmp/trigger.json" },
};

const contextWithApproval: TemplateContext = {
  ...context,
  inputs: { plan_approval_required: true },
};

describe("createTodoMarkdown", () => {
  it("renders prepended setup steps in a Worktree Creation section", () => {
    const workflow: WorkflowDef = {
      name: "Test",
      steps: [
        { kind: "prompt", name: "setup", prompt: "Setup worktree deps" },
        { kind: "prompt", name: "main", prompt: "Main task" },
      ],
      worktree_setup_start_index: 0,
      worktree_setup_count: 1,
    };

    const todo = createTodoMarkdown(workflow, context, 0);
    expect(todo).toContain("# Worktree Creation");
    expect(todo).toContain("# Primary Tasks");
    expect(todo).toContain("- [ ] Setup worktree deps");
    expect(todo).toContain("- [ ] Main task");
    expect(todo.indexOf("- [ ] Setup worktree deps")).toBeLessThan(todo.indexOf("# Primary Tasks"));
    expect(todo.indexOf("# Primary Tasks")).toBeLessThan(todo.indexOf("- [ ] Main task"));
  });

  it("inserts approval gate item and keeps later TODO items visible", () => {
    const workflow: WorkflowDef = {
      name: "Test Approval",
      steps: [
        {
          kind: "prompt",
          name: "propose",
          prompt: "Draft proposal",
          await_approval: {
            enabled: "${{ inputs.plan_approval_required }}",
            attachments: ["${{ artifacts.plan }}", "docs/notes.md"],
          },
        },
        { kind: "prompt", name: "implement", prompt: "Implement changes" },
      ],
    };

    const todo = createTodoMarkdown(workflow, contextWithApproval, 0);
    expect(todo).toContain("- [ ] Draft proposal");
    expect(todo).toContain("AWAITING APPROVAL: Send a message to wait for approval");
    expect(todo).toContain("`/tmp/plan.md`");
    expect(todo).toContain("`docs/notes.md`");
    expect(todo).toContain("- [ ] Implement changes");
    expect(todo.indexOf("AWAITING APPROVAL:")).toBeLessThan(todo.indexOf("- [ ] Implement changes"));
  });
});
