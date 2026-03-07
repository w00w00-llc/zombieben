export interface CodingAgentHandle {
  done: Promise<{ stdout: string; stderr: string }>;
  kill: () => void;
}

import type { Logger } from "@/util/logger.js";

export interface SpawnOptions {
  prompt: string;
  systemPrompt?: string;
  readonly: boolean;
  cwd?: string;
  addDirs?: string[];
  outputFormat?: "text" | "stream-json";
  interactive?: boolean;
  tools?: string[];
  log?: Logger;
  mcpConfigs?: Record<string, McpSpawnConfig>;
  env?: Record<string, string>;
}

export interface McpSpawnConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface CodingAgent {
  spawn(options: SpawnOptions): CodingAgentHandle;
}
