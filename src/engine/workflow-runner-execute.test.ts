import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { executeWorkflowSlice } from "./workflow-runner.js";
import { EXECUTE_TODOS_SYSTEM_PROMPT } from "./execute-todos-prompt.js";
import type { CodingAgent, SpawnOptions } from "@/codingagents/types.js";
import type { WorkflowDef } from "./workflow-types.js";
import type { TemplateContext } from "./workflow-template.js";

class RecordingAgent implements CodingAgent {
  public calls: SpawnOptions[] = [];

  spawn(options: SpawnOptions) {
    this.calls.push(options);
    return {
      done: Promise.resolve({ stdout: "", stderr: "" }),
      kill: () => {},
    };
  }
}

describe("executeWorkflowSlice", () => {
  it("runs TODO execution using system prompt and TODO file path prompt", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombieben-step-runner-"));
    const workingDir = path.join(root, "worktree");
    const artifactsDir = path.join(root, "artifacts");
    fs.mkdirSync(workingDir, { recursive: true });

    const workflow: WorkflowDef = {
      name: "Test",
      steps: [{ kind: "prompt", name: "do", prompt: "Do the thing" }],
    };
    const context: TemplateContext = {
      inputs: {},
      artifacts: {},
      skills: {},
      worktree: { id: "wt-1", path: workingDir },
      zombieben: { repo_slug: "org--repo", trigger: "/tmp/trigger.json" },
    };
    const agent = new RecordingAgent();

    const result = await executeWorkflowSlice(workflow, 0, context, {
      agent,
      workingDir,
      artifactsDir,
    });

    expect(result.success).toBe(true);
    expect(agent.calls).toHaveLength(1);
    expect(agent.calls[0].prompt).toContain(
      `Execute the steps in ${path.join(artifactsDir, "TODO.md")}`,
    );
    expect(agent.calls[0].prompt).toContain(
      `Use run intent file: ${path.join(root, "user_intent.md")}`,
    );
    expect(agent.calls[0].prompt).toContain(
      `write intent review to: ${path.join(artifactsDir, "intent-review.md")}`,
    );
    expect(agent.calls[0].prompt).toContain(
      "then stop immediately and exit successfully without doing any more work.",
    );
    expect(agent.calls[0].systemPrompt).toBe(EXECUTE_TODOS_SYSTEM_PROMPT);
    expect(agent.calls[0].outputFormat).toBe("stream-json");
    expect(agent.calls[0].cwd).toBe(workingDir);
    expect(agent.calls[0].stdoutLogPath).toBe(
      path.join(artifactsDir, "step-000-claude.stdout.log"),
    );
    expect(agent.calls[0].stderrLogPath).toBe(
      path.join(artifactsDir, "step-000-claude.stderr.log"),
    );

    const artifactsTodoPath = path.join(artifactsDir, "TODO.md");
    expect(fs.existsSync(artifactsTodoPath)).toBe(true);
    expect(result.todoFullyComplete).toBe(false);
  });

  it("does not overwrite existing TODO.md", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombieben-step-runner-"));
    const workingDir = path.join(root, "worktree");
    const artifactsDir = path.join(root, "artifacts");
    fs.mkdirSync(workingDir, { recursive: true });
    fs.mkdirSync(artifactsDir, { recursive: true });

    const todoPath = path.join(artifactsDir, "TODO.md");
    fs.writeFileSync(todoPath, "- [x] Preserved");

    const workflow: WorkflowDef = {
      name: "Test",
      steps: [{ kind: "prompt", name: "do", prompt: "Do the thing" }],
    };
    const context: TemplateContext = {
      inputs: {},
      artifacts: {},
      skills: {},
      worktree: { id: "wt-1", path: workingDir },
      zombieben: { repo_slug: "org--repo", trigger: "/tmp/trigger.json" },
    };
    const agent = new RecordingAgent();

    await executeWorkflowSlice(workflow, 0, context, {
      agent,
      workingDir,
      artifactsDir,
    });

    expect(fs.readFileSync(todoPath, "utf-8")).toBe("- [x] Preserved");
  });

  it("marks todoFullyComplete when all main tasks are complete", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombieben-step-runner-"));
    const workingDir = path.join(root, "worktree");
    const artifactsDir = path.join(root, "artifacts");
    fs.mkdirSync(workingDir, { recursive: true });
    fs.mkdirSync(artifactsDir, { recursive: true });

    const todoPath = path.join(artifactsDir, "TODO.md");
    fs.writeFileSync(
      todoPath,
      [
        "- [x] Task A",
        "- [s] Task B",
        "",
        "# Failure Tasks",
        "",
        "- [ ] Failure handler",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(artifactsDir, "intent-review.md"),
      [
        "## Intent Alignment",
        "",
        "### Fulfilled Requirements",
        "- Req 1",
        "",
        "### Deviations",
        "None",
        "",
        "### Evidence",
        "- src/file.ts",
      ].join("\n"),
    );

    const workflow: WorkflowDef = {
      name: "Test",
      steps: [{ kind: "prompt", name: "do", prompt: "Do the thing" }],
    };
    const context: TemplateContext = {
      inputs: {},
      artifacts: {},
      skills: {},
      worktree: { id: "wt-1", path: workingDir },
      zombieben: { repo_slug: "org--repo", trigger: "/tmp/trigger.json" },
    };
    const agent = new RecordingAgent();

    const result = await executeWorkflowSlice(workflow, 0, context, {
      agent,
      workingDir,
      artifactsDir,
    });

    expect(result.todoFullyComplete).toBe(true);
    expect(result.intentAligned).toBe(true);
  });

  it("fails completion when TODO is done but intent review is missing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombieben-step-runner-"));
    const workingDir = path.join(root, "worktree");
    const artifactsDir = path.join(root, "artifacts");
    fs.mkdirSync(workingDir, { recursive: true });
    fs.mkdirSync(artifactsDir, { recursive: true });

    fs.writeFileSync(path.join(artifactsDir, "TODO.md"), "- [x] Task A\n");

    const workflow: WorkflowDef = {
      name: "Test",
      steps: [{ kind: "prompt", name: "do", prompt: "Do the thing" }],
    };
    const context: TemplateContext = {
      inputs: {},
      artifacts: {},
      skills: {},
      worktree: { id: "wt-1", path: workingDir },
      zombieben: { repo_slug: "org--repo", trigger: "/tmp/trigger.json" },
    };
    const agent = new RecordingAgent();

    const result = await executeWorkflowSlice(workflow, 0, context, {
      agent,
      workingDir,
      artifactsDir,
    });

    expect(result.todoFullyComplete).toBe(true);
    expect(result.intentAligned).toBe(false);
    expect(result.success).toBe(false);
  });
});
