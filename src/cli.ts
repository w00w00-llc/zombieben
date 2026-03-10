import { createRequire } from "node:module";
import { Command } from "commander";
import { registerRunnerCommand } from "./commands/runner/index.js";
import { registerWorkflowsCommand } from "./commands/workflows/index.js";
import { registerUpdateCommand } from "./commands/update.js";

const require = createRequire(import.meta.url);

type PackageJson = {
  version: string;
};

export function getCliVersion(): string {
  const { version } = require("../package.json") as PackageJson;
  return version;
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("zombieben")
    .version(getCliVersion())
    .description("CLI tool for zombieben workflows");

  registerRunnerCommand(program);
  registerWorkflowsCommand(program);
  registerUpdateCommand(program);

  return program;
}
