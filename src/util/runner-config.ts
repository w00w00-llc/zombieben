import fs from "node:fs";
import path from "node:path";
import { zombiebenDir } from "./paths.js";

export type DefaultCodingAgent = "claude" | "codex";

export interface RunnerConfig {
  default_coding_agent?: string;
}

export function runnerConfigPath(): string {
  return path.join(zombiebenDir(), "config.json");
}

export function readRunnerConfig(): RunnerConfig {
  const configPath = runnerConfigPath();
  if (!fs.existsSync(configPath)) return {};

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as unknown;
    if (!raw || typeof raw !== "object") return {};
    return raw as RunnerConfig;
  } catch {
    return {};
  }
}

export function normalizeDefaultCodingAgent(
  value: unknown,
): DefaultCodingAgent | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "claude" || normalized === "codex") {
    return normalized;
  }
  return undefined;
}
