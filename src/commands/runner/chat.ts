import { Command } from "commander";
import { spawn } from "node:child_process";
import { zombiebenDir, ensureRunnerDir } from "@/util/paths.js";

const SYSTEM_PROMPT = `You are the ZombieBen runner chat interface. You help users manage their ZombieBen configuration: adding repos, setting up integrations, debugging tasks, and checking status.

Integration credentials are stored in keys.json (in this directory). Each integration owns a top-level key — for example: { "github": { "pat": "ghp_..." }, "slack": { "bot_token": "xoxb-..." } }. Use this file to read and write tokens.

IMPORTANT: Never write to, edit, or delete anything under any tasks/ directory. Those are managed by the ZombieBen runner and modifying them can corrupt running workflows.`;

const INITIAL_PROMPT = `Warn stupid human:\n\nYou've entered ZombieBen's brain (the ~/.zombieben directory). You can poke around — check on tasks, debug things, update config — but DO NOT go full zombie and start smashing things. Currently-running workflows live here, too. Any careless changes here can eat running workflows alive. Tread carefully or get bitten.`;

export function registerChatCommand(parent: Command): void {
  parent
    .command("chat")
    .description("Open Claude Code in the ~/.zombieben directory")
    .action(() => {
      ensureRunnerDir();

      const child = spawn(
        "claude",
        ["--append-system-prompt", SYSTEM_PROMPT, INITIAL_PROMPT],
        {
          cwd: zombiebenDir(),
          stdio: "inherit",
        },
      );

      child.on("error", (err) => {
        console.error(`Failed to start claude: ${err.message}`);
        process.exit(1);
      });

      child.on("exit", (code) => {
        process.exit(code ?? 0);
      });
    });
}
