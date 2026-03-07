#!/usr/bin/env node
/**
 * Usage: npx tsx scripts/render-todo.ts <workflow.yml>
 *
 * Parses a workflow and renders the TODO checklist to tmp/<name>.md.
 */
import fs from "node:fs";
import path from "node:path";
import { parseWorkflow } from "../src/engine/workflow-parser.js";
import { createTodoMarkdown } from "../src/engine/todo-generator.js";
import type { TemplateContext } from "../src/engine/workflow-template.js";

const [workflowPath] = process.argv.slice(2);

if (!workflowPath) {
  console.error("Usage: npx tsx scripts/render-todo.ts <workflow.yml>");
  process.exit(1);
}

const workflow = parseWorkflow(fs.readFileSync(workflowPath, "utf-8"));

// Stub context with placeholder values for template variables
const context: TemplateContext = {
  inputs: {},
  artifacts: {
    "failed-tests": "/tmp/artifacts/failed-tests.md",
  },
  skills: {
    "run-tests": "Run the project test suite using `npm test`",
  },
  worktree: { id: "fix-ci-123", path: "/repos/my-repo" },
  zombieben: {
    repo_slug: "my-repo",
    trigger: "GitHub Actions workflow run `e2e-tests` failed on commit abc123",
  },
};

const md = createTodoMarkdown(workflow, context);

const tmpDir = path.resolve(import.meta.dirname, "../tmp");
fs.mkdirSync(tmpDir, { recursive: true });

const baseName = path.basename(workflowPath, path.extname(workflowPath));
const outputPath = path.join(tmpDir, `${baseName}.md`);
fs.writeFileSync(outputPath, md + "\n");
console.log(`Wrote to ${outputPath}`);
