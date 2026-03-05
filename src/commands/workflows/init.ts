import { Command } from "commander";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function registerWorkflowsInitCommand(parent: Command): void {
  parent
    .command("init")
    .description("Scaffold .zombieben/ in the current repo with example workflow + worktrees.yml")
    .action(() => {
      let repoRoot: string;
      try {
        repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
          encoding: "utf-8",
        }).trim();
      } catch {
        console.error("Not inside a git repository.");
        process.exit(1);
      }

      const zbDir = path.join(repoRoot, ".zombieben");
      const workflowsDir = path.join(zbDir, "workflows");

      fs.mkdirSync(workflowsDir, { recursive: true });

      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const scaffoldDir = path.resolve(__dirname, "..", "..", "..", "scaffold");

      const scaffoldFiles: Array<{ src: string; dest: string }> = [
        {
          src: path.join(scaffoldDir, "worktrees.yml"),
          dest: path.join(zbDir, "worktrees.yml"),
        },
        {
          src: path.join(scaffoldDir, "example-workflow.yml"),
          dest: path.join(workflowsDir, "example-workflow.yml"),
        },
      ];

      const created: string[] = [];
      const existed: string[] = [];

      for (const { src, dest } of scaffoldFiles) {
        const relPath = path.relative(repoRoot, dest);
        if (fs.existsSync(dest)) {
          existed.push(relPath);
        } else if (fs.existsSync(src)) {
          fs.cpSync(src, dest);
          created.push(relPath);
        }
      }

      if (created.length > 0) {
        console.log("Created:");
        for (const f of created) console.log(`  ${f}`);
      }
      if (existed.length > 0) {
        console.log("Already existed:");
        for (const f of existed) console.log(`  ${f}`);
      }
      if (created.length === 0) {
        console.log("All files already present — nothing to do.");
      } else {
        console.log(
          "\nScaffolded .zombieben/ directory. Edit the files to configure your workflows."
        );
      }
    });
}
