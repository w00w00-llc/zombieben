import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { ensureRunnerDir } from "@/util/paths.js";

export function registerUpdateCommand(program: Command): void {
  program
    .command("update")
    .description("Sync install-provided files without clobbering user data")
    .action(async () => {
      ensureRunnerDir();
      console.log("Update complete.");
    });
}
