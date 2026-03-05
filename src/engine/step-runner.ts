import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import type { WorkflowStepDef, ScriptStepDef } from "@/workflow/types/index.js";
import type { TemplateContext } from "@/workflow/template.js";
import { renderStepTodo } from "./todo-generator.js";

const execFile = promisify(execFileCb);

export interface StepResult {
  success: boolean;
  summary?: string;
  failures?: string[];
  artifacts?: string[];
}

export interface StepRunnerOpts {
  chatCommand?: string;
  workingDir: string;
  artifactsDir: string;
  dryRun?: boolean;
}

/**
 * Execute a script step by running a shell command.
 */
export async function executeScriptStep(
  step: ScriptStepDef,
  opts: StepRunnerOpts
): Promise<StepResult> {
  if (opts.dryRun) {
    return { success: true, summary: "Dry run — skipped execution" };
  }

  try {
    const { stdout } = await execFile("sh", ["-c", step.runs], {
      cwd: opts.workingDir,
      maxBuffer: 50 * 1024 * 1024,
    });
    return { success: true, summary: stdout.trim() || "Script completed successfully" };
  } catch (err) {
    const error = err as Error & { stdout?: string; stderr?: string };
    return {
      success: false,
      summary: error.stderr?.trim() || error.message,
    };
  }
}

/**
 * Execute a single workflow step by:
 * 1. Generating a TODO.md
 * 2. Running `claude -p` with the TODO content
 * 3. Reading the execution_result.json
 */
export async function executeStep(
  step: WorkflowStepDef,
  context: TemplateContext,
  opts: StepRunnerOpts
): Promise<StepResult> {
  if (step.kind === "script") {
    return executeScriptStep(step, opts);
  }

  const todo = renderStepTodo(step, context, opts.artifactsDir);

  // Write TODO.md for debugging / audit trail
  const todoPath = path.join(opts.artifactsDir, "TODO.md");
  fs.mkdirSync(opts.artifactsDir, { recursive: true });
  fs.writeFileSync(todoPath, todo);

  if (opts.dryRun) {
    return { success: true, summary: "Dry run — skipped execution" };
  }

  const chatCommand = opts.chatCommand ?? "claude";

  try {
    await execFile(chatCommand, ["-p", todo], {
      cwd: opts.workingDir,
      maxBuffer: 50 * 1024 * 1024, // 50MB
    });
  } catch (err) {
    return {
      success: false,
      summary: `Chat command failed: ${(err as Error).message}`,
    };
  }

  // Read execution_result.json
  return readExecutionResult(opts.artifactsDir);
}

export function readExecutionResult(artifactsDir: string): StepResult {
  const resultPath = path.join(artifactsDir, "execution_result.json");
  try {
    const raw = fs.readFileSync(resultPath, "utf-8");
    const parsed = JSON.parse(raw) as StepResult;
    // Clean up the result file after reading
    fs.unlinkSync(resultPath);
    return parsed;
  } catch {
    // If no result file, assume success (agent completed without error)
    return { success: true, summary: "No execution_result.json found — assumed success" };
  }
}
