import fs from "node:fs";
import { worktreeDir, worktreeMetadataPath } from "@/util/paths.js";

export type WorktreeMetadata = Record<string, unknown>;

export function ensureWorktreeMetadataFile(
  repoSlug: string,
  worktreeId: string,
): string {
  const wtDir = worktreeDir(repoSlug, worktreeId);
  fs.mkdirSync(wtDir, { recursive: true });

  const metadataPath = worktreeMetadataPath(repoSlug, worktreeId);
  if (!fs.existsSync(metadataPath)) {
    fs.writeFileSync(metadataPath, "{}\n");
  }

  return metadataPath;
}

export function readWorktreeMetadata(
  repoSlug: string,
  worktreeId: string,
): WorktreeMetadata {
  const metadataPath = ensureWorktreeMetadataFile(repoSlug, worktreeId);

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
  } catch (err) {
    throw new Error(
      `Invalid worktree metadata JSON at ${metadataPath}: ${(err as Error).message}`,
      { cause: err },
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid worktree metadata JSON at ${metadataPath}: expected an object`);
  }

  return parsed as WorktreeMetadata;
}
