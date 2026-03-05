import { Command } from "commander";
import { scanAllRuns } from "@/runner/scanner.js";

export function registerStatusCommand(parent: Command): void {
  parent
    .command("status")
    .description("Show status of all workflow runs")
    .action(() => {
      const runs = scanAllRuns();

      if (runs.length === 0) {
        console.log("No workflow runs found.");
        return;
      }

      for (const run of runs) {
        const s = run.state;
        console.log(
          `${run.repoSlug}/${run.worktreeId}  ${s.workflow_name}  ${s.status}  step=${s.step_index}/${s.step_name}  attempt=${s.attempt}`
        );
      }
    });
}
