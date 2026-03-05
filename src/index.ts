#!/usr/bin/env node
import { Command } from "commander";
import { registerRunnerCommand } from "./commands/runner/index.js";
import { registerWorkflowsCommand } from "./commands/workflows/index.js";
import { registerUpdateCommand } from "./commands/update.js";

const program = new Command();

program
  .name("zombieben")
  .version("0.1.0")
  .description("CLI tool for zombieben workflows");

registerRunnerCommand(program);
registerWorkflowsCommand(program);
registerUpdateCommand(program);

program.parse();
