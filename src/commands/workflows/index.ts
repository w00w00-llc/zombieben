import { Command } from "commander";
import { registerWorkflowsInitCommand } from "./init.js";
import { registerWorkflowsValidateCommand } from "./validate.js";

export function registerWorkflowsCommand(program: Command): void {
  const workflows = program
    .command("workflows")
    .description("Manage workflow definitions");

  registerWorkflowsInitCommand(workflows);
  registerWorkflowsValidateCommand(workflows);
}
