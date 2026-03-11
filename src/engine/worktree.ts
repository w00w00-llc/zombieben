import fs from "node:fs";
import path from "node:path";
import { execFile as execFileCb, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import {
  mainRepoDir,
  worktreeRepoDir,
  worktreeDir,
} from "@/util/paths.js";
import { readRepoConfig } from "@/util/repo-config.js";
import { ensureWorktreeMetadataFile } from "./worktree-metadata.js";

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
  ensureWorktreeMetadataFile(repoSlug, worktreeId);

  await execFile("git", ["worktree", "add", "-b", branchName, dest], {
    cwd: mainRepoDir(repoSlug),
  });
  applyRepoEnvConfig(repoSlug, dest);

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

function applyRepoEnvConfig(repoSlug: string, worktreeRepoPath: string): void {
  const env = readRepoConfig(repoSlug).env;
  if (!env || Object.keys(env).length === 0) return;

  const envPath = path.join(worktreeRepoPath, ".env");
  const existing = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, "utf-8")
    : "";
  fs.writeFileSync(envPath, mergeDotenv(existing, env));
}

function mergeDotenv(
  content: string,
  updates: Record<string, string>,
): string {
  const lines = content === "" ? [] : content.split(/\r?\n/);
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }

  const remaining = new Set(Object.keys(updates));
  const output: string[] = [];

  for (const line of lines) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    const key = match?.[1];
    if (key && Object.prototype.hasOwnProperty.call(updates, key)) {
      if (remaining.has(key)) {
        output.push(`${key}=${formatDotenvValue(updates[key])}`);
        remaining.delete(key);
      }
      continue;
    }

    output.push(line);
  }

  if (remaining.size > 0 && output.length > 0 && output[output.length - 1] !== "") {
    output.push("");
  }
  for (const key of Object.keys(updates)) {
    if (remaining.has(key)) {
      output.push(`${key}=${formatDotenvValue(updates[key])}`);
    }
  }

  return `${output.join("\n")}\n`;
}

function formatDotenvValue(value: string): string {
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) {
    return value;
  }

  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
  return `"${escaped}"`;
}
