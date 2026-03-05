import { Command } from "commander";
import { registerChatCommand } from "./chat.js";
import { registerStartCommand } from "./start.js";
import { registerStatusCommand } from "./status.js";
import { registerLogsCommand } from "./logs.js";
import { registerStopCommand } from "./stop.js";

export function registerRunnerCommand(program: Command): void {
  const runner = program
    .command("runner")
    .description("ZombieBen runner daemon and management");

  registerChatCommand(runner);
  registerLogsCommand(runner);
  registerStartCommand(runner);
  registerStatusCommand(runner);
  registerStopCommand(runner);
}
