#!/usr/bin/env node
/**
 * Usage: npx tsx scripts/test-todo.ts [-i] <todo.md>
 *
 * Spawns a coding agent with the execute-todos system prompt,
 * feeding it the provided TODO markdown. Runs in tmp/ (project root).
 * Intended to be used with the TODO files in test-todos/.
 *
 * Flags:
 *   -i    Run interactively (stdio inherited)
 */
import fs from "node:fs";
import path from "node:path";
import { ClaudeCodingAgent } from "../src/codingagents/claude.js";
import { EXECUTE_TODOS_SYSTEM_PROMPT } from "../src/engine/execute-todos-prompt.js";

const args = process.argv.slice(2);
const interactive = args.includes("-i");
const todoPath = args.find((a) => a !== "-i");

if (!todoPath) {
  console.error("Usage: npx tsx scripts/test-todo.ts [-i] <todo.md>");
  process.exit(1);
}

const workDir = path.resolve(import.meta.dirname, "../tmp");
fs.mkdirSync(workDir, { recursive: true });

const localTodo = path.join(workDir, "TODO.md");
fs.copyFileSync(todoPath, localTodo);

const agent = new ClaudeCodingAgent();
const handle = agent.spawn({
  prompt: `Execute the steps in ./TODO.md`,
  systemPrompt: EXECUTE_TODOS_SYSTEM_PROMPT,
  readonly: false,
  interactive,
  cwd: workDir,
});

try {
  await handle.done;
} catch (err) {
  console.error(`Agent failed: ${(err as Error).message}`);
  process.exit(1);
}
