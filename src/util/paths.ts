import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const DEFAULT_ZOMBIEBEN_RUNNER_DIR = path.join(os.homedir(), ".zombieben");

// Resolve from dist/util/paths.js → ../../chat-skills (package root)
const CHAT_SKILLS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..", "..", "chat-skills",
);

// Resolve from dist/util/paths.js → ../../src/integrations
const INTEGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..", "..", "src", "integrations",
);

/** Lazily create ~/.zombieben with repos/ and skill symlinks. */
export function ensureRunnerDir(): void {
  const dir = zombiebenDir();
  fs.mkdirSync(path.join(dir, "repos"), { recursive: true });

  // Symlink .agents/skills → chat-skills inside the package
  const agentsSkills = path.join(dir, ".agents", "skills");
  if (!fs.existsSync(agentsSkills)) {
    fs.mkdirSync(path.join(dir, ".agents"), { recursive: true });
    fs.symlinkSync(CHAT_SKILLS_DIR, agentsSkills);
  }

  // Symlink .claude/skills → .agents/skills
  const claudeSkills = path.join(dir, ".claude", "skills");
  if (!fs.existsSync(claudeSkills)) {
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
    fs.symlinkSync(path.join(dir, ".agents", "skills"), claudeSkills);
  }
}

export function zombiebenDir(): string {
  return process.env.ZOMBIEBEN_RUNNER_DIR ?? DEFAULT_ZOMBIEBEN_RUNNER_DIR;
}


export function reposDir(): string {
  return path.join(zombiebenDir(), "repos");
}

export function repoDir(repoSlug: string): string {
  return path.join(reposDir(), repoSlug);
}

export function mainRepoDir(repoSlug: string): string {
  return path.join(repoDir(repoSlug), "main_repo");
}

// --- Worktree paths ---

export function worktreesDir(repoSlug: string): string {
  return path.join(repoDir(repoSlug), "tasks");
}

export function worktreeDir(repoSlug: string, worktreeId: string): string {
  return path.join(worktreesDir(repoSlug), worktreeId);
}

export function worktreeRepoDir(repoSlug: string, worktreeId: string): string {
  return path.join(worktreeDir(repoSlug, worktreeId), "repo");
}

// --- Run paths (inside worktrees) ---

export function runsDir(repoSlug: string, worktreeId: string): string {
  return path.join(worktreeDir(repoSlug, worktreeId), "runs");
}

export function runDir(repoSlug: string, worktreeId: string, runId: string): string {
  return path.join(runsDir(repoSlug, worktreeId), runId);
}

export function runStatePath(repoSlug: string, worktreeId: string, runId: string): string {
  return path.join(runDir(repoSlug, worktreeId, runId), "workflow_state.json");
}

export function runArtifactsDir(repoSlug: string, worktreeId: string, runId: string): string {
  return path.join(runDir(repoSlug, worktreeId, runId), "artifacts");
}

// --- Workflow paths (inside repos) ---

export function repoWorkflowsDir(repoSlug: string): string {
  return path.join(mainRepoDir(repoSlug), ".zombieben", "workflows");
}

export function repoWorktreesConfigPath(repoSlug: string): string {
  return path.join(mainRepoDir(repoSlug), ".zombieben", "worktrees.yml");
}

// --- Ingestor paths ---

export function ingestorDir(): string {
  return path.join(zombiebenDir(), "ingestor");
}

export function seenTriggersPath(): string {
  return path.join(ingestorDir(), "seen_triggers.json");
}

// --- Runner log ---

export function runnerLogPath(): string {
  return path.join(zombiebenDir(), "runner.log");
}

export function runnerLogsDir(): string {
  return path.join(zombiebenDir(), "runner-logs");
}

export function runnerDailyLogPath(date: Date = new Date()): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return path.join(runnerLogsDir(), `${yyyy}-${mm}-${dd}.log`);
}

export function runLogPath(repoSlug: string, worktreeId: string, runId: string): string {
  return path.join(runDir(repoSlug, worktreeId, runId), "run.log");
}

export function integrationsDir(): string {
  return INTEGRATIONS_DIR;
}
