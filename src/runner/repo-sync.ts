import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import yaml from "js-yaml";
import { reposDir, mainRepoDir, worktreeRepoDir } from "@/util/paths.js";
import { log } from "@/util/logger.js";

const execFileAsync = promisify(execFile);

function getDefaultBranch(repoSlug: string): string {
  const configPath = path.join(
    mainRepoDir(repoSlug),
    ".zombieben",
    "config.yml",
  );
  try {
    const raw = yaml.load(fs.readFileSync(configPath, "utf-8")) as Record<
      string,
      unknown
    > | null;
    if (raw && typeof raw.default_branch === "string") {
      return raw.default_branch;
    }
  } catch {
    // Missing or invalid config — fall back
  }
  return "main";
}

export async function syncRepo(repoSlug: string): Promise<void> {
  const dir = mainRepoDir(repoSlug);
  if (!fs.existsSync(dir)) return;

  const branch = getDefaultBranch(repoSlug);
  const opts = { cwd: dir };

  await execFileAsync("git", ["fetch", "origin", branch, "--quiet"], opts);
  await execFileAsync("git", ["reset", "--hard", `origin/${branch}`], opts);
}

export async function rebaseWorktreeOntoDefaultBranch(
  repoSlug: string,
  worktreeId: string,
): Promise<void> {
  const dir = worktreeRepoDir(repoSlug, worktreeId);
  if (!fs.existsSync(dir)) return;

  const branch = getDefaultBranch(repoSlug);
  const opts = { cwd: dir };

  await execFileAsync("git", ["fetch", "origin", branch, "--quiet"], opts);
  await execFileAsync("git", ["rebase", `origin/${branch}`], opts);
}

export async function syncAllRepos(): Promise<void> {
  const dir = reposDir();
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const repos = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  await Promise.all(
    repos.map((slug) =>
      syncRepo(slug).catch((err) => {
        log.error(`Failed to sync repo ${slug}: ${(err as Error).message}`);
      }),
    ),
  );
}
