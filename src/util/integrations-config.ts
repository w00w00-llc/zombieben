import fs from "node:fs";
import path from "node:path";
import { zombiebenDir } from "./paths.js";

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface IntegrationConfig {
  mcp?: McpServerConfig;
  env_var?: string;
}

export type IntegrationsConfig = Record<string, IntegrationConfig>;

export function integrationsConfigPath(): string {
  return path.join(zombiebenDir(), "integrations.json");
}

export function readIntegrationsConfig(): IntegrationsConfig {
  const p = integrationsConfigPath();
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, "utf-8")) as IntegrationsConfig;
}

export function getIntegrationConfig(id: string): IntegrationConfig | undefined {
  return readIntegrationsConfig()[id];
}
