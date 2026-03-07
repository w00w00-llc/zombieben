import { Command } from "commander";
import { zombiebenDir, ensureRunnerDir, integrationsDir } from "@/util/paths.js";
import { ClaudeCodingAgent } from "@/codingagents/index.js";

const SYSTEM_PROMPT = `You are the ZombieBen runner chat interface. You help users manage their ZombieBen configuration: adding repos, setting up integrations, debugging tasks, and checking status.

Integration credentials are stored in keys.json (in this directory). Each integration owns a top-level key — for example: { "github": { "pat": "ghp_..." }, "slack": { "bot_token": "xoxb-..." } }. Use this file to read and write tokens.

IMPORTANT: Never write to, edit, or delete anything under any tasks/ directory. Those are managed by the ZombieBen runner and modifying them can corrupt running workflows.

Integration setup guides are in INTEGRATION.md files. To find available integrations and their setup instructions, list the directory at ${integrationsDir()} and read the INTEGRATION.md in each subdirectory.`;

const INITIAL_PROMPT = `Warn stupid human:\n\nYou've entered ZombieBen's brain (the ~/.zombieben directory). You can poke around — check on tasks, debug things, update config — but DO NOT go full zombie and start smashing things. Currently-running workflows live here, too. Any careless changes here can eat running workflows alive. Tread carefully or get bitten.`;

export function registerChatCommand(parent: Command): void {
  parent
    .command("chat")
    .description("Open Claude Code in the ~/.zombieben directory")
    .action(async () => {
      ensureRunnerDir();

      const agent = new ClaudeCodingAgent();
      const handle = agent.spawn({
        prompt: INITIAL_PROMPT,
        systemPrompt: SYSTEM_PROMPT,
        readonly: false,
        interactive: true,
        cwd: zombiebenDir(),
      });

      try {
        await handle.done;
      } catch (err) {
        console.error(`Failed to start claude: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
