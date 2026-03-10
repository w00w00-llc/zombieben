#!/usr/bin/env node
/**
 * Usage: npx tsx scripts/test-workflow.ts [-i] <workflow.yml>
 *
 * Renders a workflow into a TODO checklist, then spawns a coding agent to
 * execute it. Combines render-todo.ts and test-todo.ts.
 *
 * Flags:
 *   -i    Run interactively (stdio inherited)
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
const interactive = args.includes("-i");
const workflowPath = args.find((a) => a !== "-i");

if (!workflowPath) {
  console.error("Usage: npx tsx scripts/test-workflow.ts [-i] <workflow.yml>");
  process.exit(1);
}

const scriptsDir = import.meta.dirname;
const baseName = path.basename(workflowPath, path.extname(workflowPath));
const todoPath = path.resolve(scriptsDir, `../tmp/${baseName}.md`);

// Render workflow → TODO
execFileSync(
  "npx",
  ["tsx", path.join(scriptsDir, "render-todo.ts"), workflowPath],
  {
    stdio: "inherit",
  },
);

// Execute TODO
const testTodoArgs = [
  "tsx",
  path.join(scriptsDir, "test-todo.ts"),
  ...(interactive ? ["-i"] : []),
  todoPath,
];
execFileSync("npx", testTodoArgs, { stdio: "inherit" });
