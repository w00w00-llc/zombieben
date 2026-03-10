import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import yaml from "js-yaml";
import { reposDir, mainRepoDir, worktreeRepoDir } from "@/util/paths.js";
import { log } from "@/util/logger.js";
import type { CodingAgent } from "@/codingagents/index.js";

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
  agent?: CodingAgent,
): Promise<void> {
  const dir = worktreeRepoDir(repoSlug, worktreeId);
  if (!fs.existsSync(dir)) return;

  const branch = getDefaultBranch(repoSlug);
  const opts = { cwd: dir };

  if (agent) {
    await execFileAsync("git", ["fetch", "origin", branch, "--quiet"], opts);
    await runFullRebaseWithAgent(agent, dir, branch, repoSlug, worktreeId);
    if (await isRebaseInProgress(dir)) {
      throw new Error(
        `Rebase still in progress after agent-managed rebase for ${repoSlug}/${worktreeId}`,
      );
    }
    return;
  }

  await execFileAsync("git", ["fetch", "origin", branch, "--quiet"], opts);
  try {
    await execFileAsync("git", ["rebase", `origin/${branch}`], opts);
    return;
  } catch (err) {
    throw new Error(
      `git rebase origin/${branch} failed: ${(err as Error).message}`,
      { cause: err as Error },
    );
  }
}

async function runFullRebaseWithAgent(
  agent: CodingAgent,
  cwd: string,
  branch: string,
  repoSlug: string,
  worktreeId: string,
): Promise<void> {
  log.info(
    `Using coding agent for full rebase of ${repoSlug}/${worktreeId} onto origin/${branch}`,
  );
  const prompt = [
    `Git fetch for origin/${branch} has already completed.`,
    `Rebase this branch onto origin/${branch}.`,
    "",
    "Perform the full sequence yourself:",
    `1) git rebase origin/${branch}`,
    "2) If there are conflicts, resolve them correctly, stage, and run git rebase --continue",
    "3) Repeat step 2 until rebase completes",
    "",
    "Requirements:",
    "- Do not abort the rebase unless it is impossible to complete safely",
    "- Preserve intent from both sides when resolving conflicts",
    "- At the end, ensure no rebase is in progress",
    "- Run: git status --short",
    "- Run: git log --oneline -n 5",
  ].join("\n");

  const handle = agent.spawn({
    prompt,
    readonly: false,
    cwd,
    outputFormat: "stream-json",
  });
  await handle.done;
  if (await isRebaseInProgress(cwd)) {
    throw new Error(
      `Rebase still in progress after agent-managed rebase for ${repoSlug}/${worktreeId}`,
    );
  }
  log.info(
    `Agent finished full rebase for ${repoSlug}/${worktreeId}`,
  );
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

async function isRebaseInProgress(cwd: string): Promise<boolean> {
  try {
    const rebaseMerge = await gitPathExists(cwd, "rebase-merge");
    const rebaseApply = await gitPathExists(cwd, "rebase-apply");
    return rebaseMerge || rebaseApply;
  } catch {
    return false;
  }
}

async function gitPathExists(cwd: string, gitPath: string): Promise<boolean> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "--git-path", gitPath], { cwd });
  return fs.existsSync(stdout.trim());
}
