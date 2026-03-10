import type { CodingAgent } from "./types.js";
import { ClaudeCodingAgent } from "./claude.js";
import { CodexCodingAgent } from "./codex.js";
import {
  normalizeDefaultCodingAgent,
  readRunnerConfig,
  type DefaultCodingAgent,
} from "@/util/runner-config.js";

export function resolveDefaultCodingAgent(): DefaultCodingAgent {
  const config = readRunnerConfig();
  return normalizeDefaultCodingAgent(config.default_coding_agent) ?? "claude";
}

export function createCodingAgent(agent?: string): CodingAgent {
  const selected = normalizeDefaultCodingAgent(agent) ?? resolveDefaultCodingAgent();
  if (selected === "codex") {
    return new CodexCodingAgent();
  }
  return new ClaudeCodingAgent();
}
