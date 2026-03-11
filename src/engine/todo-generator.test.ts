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

  it("renders foreach steps with parsed parameter in TODO form", () => {
    const workflow: WorkflowDef = {
      name: "Foreach",
      steps: [
        {
          kind: "prompt",
          name: "Write file",
          prompt: "Create a file ./foreach. Write 5 lines into it, each line with a new, randomly-generated word",
        },
        {
          kind: "foreach",
          name: "New words",
          foreach: "line in ./foreach.txt",
          parameter: "line",
          steps: [
            {
              kind: "prompt",
              name: "Append line",
              prompt: "Append {line} to ./foreach.txt",
            },
          ],
        },
      ],
    };

    const todo = createTodoMarkdown(workflow, context, 0);
    expect(todo).toContain("- [ ] Create a file ./foreach. Write 5 lines into it, each line with a new, randomly-generated word");
    expect(todo).toContain('- [ ] For each line in ./foreach.txt, add a TODO below this item with the contents: "Append {line} to ./foreach.txt"');
  });

  it("renders multi-step foreach templates with explicit sub-step summaries", () => {
    const workflow: WorkflowDef = {
      name: "Capture Screen Recordings",
      steps: [
        {
          kind: "foreach",
          name: "Capture screen recordings",
          foreach: "screen recording in ${{ artifacts.plan }}",
          parameter: "screen",
          steps: [
            {
              kind: "prompt",
              name: "Capture screen recording",
              prompt: "Capture the flow for the screen recording",
            },
            {
              kind: "prompt",
              name: "Upload screen recording",
              prompt: "Upload the screen recording to S3 and verify the CloudFront URL",
            },
            {
              kind: "prompt",
              name: "Remove e2e test",
              prompt: "Delete the ad-hoc e2e test",
            },
          ],
        },
      ],
    };

    const todo = createTodoMarkdown(workflow, {
      ...context,
      artifacts: { ...context.artifacts, plan: "/tmp/screen-recordings-plan.md" },
    }, 0);
    expect(todo).toContain(
      "- [ ] For each screen recording in /tmp/screen-recordings-plan.md, add TODO items below this item using this template:",
    );
    expect(todo).toContain("1. Capture screen recording: Capture the flow for the screen recording");
    expect(todo).toContain("2. Upload screen recording: Upload the screen recording to S3 and verify the CloudFront URL");
    expect(todo).toContain("3. Remove e2e test: Delete the ad-hoc e2e test");
  });

  it("renders freeform conditions as agent-evaluable skip instructions", () => {
    const workflow: WorkflowDef = {
      name: "Conditional",
      steps: [
        {
          kind: "prompt",
          name: "maybe-fix",
          prompt: "Fix the generated file",
          condition: {
            outcome: "success",
            ai_condition: "the generated file contains at least one error",
          },
        },
      ],
    };

    const todo = createTodoMarkdown(workflow, context, 0);
    expect(todo).toContain(
      "Only do this if the generated file contains at least one error: Fix the generated file. Otherwise, mark this item as skipped and continue.",
    );
  });
});
