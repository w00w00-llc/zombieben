import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { repoDir } from "./paths.js";

export interface RepoConfig {
  github_url?: string;
  env?: Record<string, string>;
}

export function repoConfigPath(repoSlug: string): string {
  return path.join(repoDir(repoSlug), "repo-config.yml");
}

export function readRepoConfig(repoSlug: string): RepoConfig {
  const configPath = repoConfigPath(repoSlug);
  if (!fs.existsSync(configPath)) return {};

  try {
    const raw = yaml.load(fs.readFileSync(configPath, "utf-8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return {};
    }

    const config = raw as Record<string, unknown>;
    const githubUrl =
      typeof config.github_url === "string" ? config.github_url : undefined;
    const env = normalizeRepoEnv(config.env);

    return {
      ...(githubUrl ? { github_url: githubUrl } : {}),
      ...(env ? { env } : {}),
    };
  } catch {
    return {};
  }
}

function normalizeRepoEnv(
  value: unknown,
): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const env: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isValidEnvKey(key)) continue;

    if (typeof raw === "string") {
      env[key] = raw;
    } else if (typeof raw === "number" || typeof raw === "boolean") {
      env[key] = String(raw);
    } else if (raw == null) {
      env[key] = "";
    }
  }

  return Object.keys(env).length > 0 ? env : undefined;
}

function isValidEnvKey(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
}
