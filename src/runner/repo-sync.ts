import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import yaml from "js-yaml";
import { reposDir, mainRepoDir, worktreeRepoDir } from "@/util/paths.js";
import { log } from "@/util/logger.js";
import type { CodingAgent } from "@/codingagents/index.js";

const execFileAsync = promisify(execFile);
const repoGitLocks = new Map<string, Promise<void>>();

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
  await withRepoGitLock(repoSlug, async () => {
    const dir = mainRepoDir(repoSlug);
    if (!fs.existsSync(dir)) return;

    const branch = getDefaultBranch(repoSlug);
    const opts = { cwd: dir };

    await fetchDefaultBranchWithRetry(dir, branch);
    await execFileAsync("git", ["reset", "--hard", `origin/${branch}`], opts);
  });
}

export async function rebaseWorktreeOntoDefaultBranch(
  repoSlug: string,
  worktreeId: string,
  agent?: CodingAgent,
): Promise<void> {
  await withRepoGitLock(repoSlug, async () => {
    const dir = worktreeRepoDir(repoSlug, worktreeId);
    if (!fs.existsSync(dir)) return;

    const branch = getDefaultBranch(repoSlug);
    const opts = { cwd: dir };

    if (agent) {
      await fetchDefaultBranchWithRetry(dir, branch);
      await runFullRebaseWithAgent(agent, dir, branch, repoSlug, worktreeId);
      if (await isRebaseInProgress(dir)) {
        throw new Error(
          `Rebase still in progress after agent-managed rebase for ${repoSlug}/${worktreeId}`,
        );
      }
      return;
    }

    await fetchDefaultBranchWithRetry(dir, branch);
    try {
      await execFileAsync("git", ["rebase", `origin/${branch}`], opts);
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `git rebase origin/${branch} failed: ${message}`,
        { cause: err },
      );
    }
  });
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

async function withRepoGitLock<T>(
  repoSlug: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = repoGitLocks.get(repoSlug) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  repoGitLocks.set(repoSlug, current);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (repoGitLocks.get(repoSlug) === current) {
      repoGitLocks.delete(repoSlug);
    }
  }
}

async function fetchDefaultBranchWithRetry(
  cwd: string,
  branch: string,
): Promise<void> {
  const opts = { cwd };
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await execFileAsync("git", ["fetch", "origin", branch, "--quiet"], opts);
      return;
    } catch (err) {
      if (
        attempt < maxAttempts
        && isGitRefLockRaceError(err)
      ) {
        await sleep(attempt * 200);
        continue;
      }
      throw err;
    }
  }
}

function isGitRefLockRaceError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("cannot lock ref 'refs/remotes/origin/")
    && message.includes("but expected");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
