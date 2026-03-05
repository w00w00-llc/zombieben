import fs from "node:fs";
import { execFile as execFileCb, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import {
  mainRepoDir,
  worktreeRepoDir,
  worktreeDir,
  worktreeArtifactsDir,
} from "./paths.js";

const execFile = promisify(execFileCb);

export async function createWorktree(
  repoSlug: string,
  worktreeId: string,
  branch?: string
): Promise<string> {
  const dest = worktreeRepoDir(repoSlug, worktreeId);
  const branchName = branch ?? `zb/${worktreeId}`;

  // Create the worktree directory structure
  const wtDir = worktreeDir(repoSlug, worktreeId);
  fs.mkdirSync(wtDir, { recursive: true });
  fs.mkdirSync(worktreeArtifactsDir(repoSlug, worktreeId), { recursive: true });

  await execFile("git", ["worktree", "add", "-b", branchName, dest], {
    cwd: mainRepoDir(repoSlug),
  });

  return dest;
}

export function removeWorktree(repoSlug: string, worktreeId: string): void {
  const repoDir = worktreeRepoDir(repoSlug, worktreeId);
  const repoRoot = mainRepoDir(repoSlug);

  try {
    execFileSync("git", ["worktree", "remove", "--force", repoDir], {
      cwd: repoRoot,
    });
  } catch { /* worktree may not exist */ }

  try {
    execFileSync("git", ["worktree", "prune"], { cwd: repoRoot });
  } catch { /* prune may fail if no worktrees */ }

  // Remove the entire worktree directory (artifacts, state, repo)
  const wtDir = worktreeDir(repoSlug, worktreeId);
  fs.rmSync(wtDir, { recursive: true, force: true });
}
