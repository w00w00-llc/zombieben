import { Command } from "commander";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  parseWorkflow,
  parseWorktreesConfig,
  validateWorkflow,
  validateWorktreesConfig,
} from "@/engine/workflow-parser.js";
import {
  collectRequiredIntegrations,
  checkRequiredIntegrations,
} from "@/engine/integration-checker.js";

export function registerWorkflowsValidateCommand(parent: Command): void {
  parent
    .command("validate")
    .description("Validate .zombieben/workflows/*.yml and worktrees.yml")
    .option(
      "-d, --dir <path>",
      "Path to repo root (defaults to git root of cwd)"
    )
    .action((opts) => {
      let repoRoot: string;
      if (opts.dir) {
        repoRoot = path.resolve(opts.dir);
      } else {
        try {
          repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
            encoding: "utf-8",
          }).trim();
        } catch {
          console.error(
            "Not inside a git repository. Use --dir to specify path."
          );
          process.exit(1);
        }
      }

      const zbDir = path.join(repoRoot, ".zombieben");
      if (!fs.existsSync(zbDir)) {
        console.error(
          `.zombieben/ not found in ${repoRoot}. Run "zombieben workflows init" first.`
        );
        process.exit(1);
      }

      let hasErrors = false;

      // Validate workflows
      const workflowsDir = path.join(zbDir, "workflows");
      if (fs.existsSync(workflowsDir)) {
        const files = fs
          .readdirSync(workflowsDir)
          .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

        if (files.length === 0) {
          console.log("No workflow files found in .zombieben/workflows/");
        }

        for (const file of files) {
          const filePath = path.join(workflowsDir, file);
          try {
            const content = fs.readFileSync(filePath, "utf-8");
            const workflow = parseWorkflow(content);
            const errors = validateWorkflow(workflow);

            if (errors.length > 0) {
              hasErrors = true;
              console.error(`\n${file}:`);
              for (const err of errors) {
                console.error(`  ${err.path}: ${err.message}`);
              }
            } else {
              console.log(`${file}: valid`);

              // Check integration availability (warning only)
              const required = collectRequiredIntegrations(workflow);
              if (required.size > 0) {
                const check = checkRequiredIntegrations(required);
                if (!check.ok) {
                  for (const name of check.missing) {
                    console.warn(
                      `  Warning: requires integration "${name}" which is not configured`,
                    );
                  }
                }
              }
            }
          } catch (err) {
            hasErrors = true;
            console.error(
              `\n${file}: parse error — ${(err as Error).message}`
            );
          }
        }
      }

      // Validate worktrees.yml
      const worktreesPath = path.join(zbDir, "worktrees.yml");
      if (fs.existsSync(worktreesPath)) {
        try {
          const content = fs.readFileSync(worktreesPath, "utf-8");
          const config = parseWorktreesConfig(content);
          const errors = validateWorktreesConfig(config);

          if (errors.length > 0) {
            hasErrors = true;
            console.error("\nworktrees.yml:");
            for (const err of errors) {
              console.error(`  ${err.path}: ${err.message}`);
            }
          } else {
            console.log("worktrees.yml: valid");
          }
        } catch (err) {
          hasErrors = true;
          console.error(
            `\nworktrees.yml: parse error — ${(err as Error).message}`
          );
        }
      }

      if (hasErrors) {
        process.exit(1);
      }
    });
}
