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
  env?: Record<string, string>;
  required_keys?: string[];
}

export type IntegrationsConfig = Record<string, IntegrationConfig>;

const DEFAULT_INTEGRATION_CONFIGS: IntegrationsConfig = {
  aws: {
    env: {
      AWS_ACCESS_KEY_ID: "$access_key_id",
      AWS_SECRET_ACCESS_KEY: "$secret_access_key",
      AWS_REGION: "$region",
      AWS_CLOUDFRONT_DISTRIBUTION_URL: "$cloudfront_distribution_url",
      AWS_BUCKET_NAME: "$bucket_name",
    },
    required_keys: [
      "access_key_id",
      "secret_access_key",
      "region",
      "cloudfront_distribution_url",
      "bucket_name",
    ],
  },
};

export function integrationsConfigPath(): string {
  return path.join(zombiebenDir(), "integrations.json");
}

export function readIntegrationsConfig(): IntegrationsConfig {
  const p = integrationsConfigPath();
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, "utf-8")) as IntegrationsConfig;
}

export function getIntegrationConfig(id: string): IntegrationConfig | undefined {
  const defaults = DEFAULT_INTEGRATION_CONFIGS[id];
  const configured = readIntegrationsConfig()[id];
  if (!defaults) return configured;
  if (!configured) return defaults;

  const mergedMcp = mergeMcpConfig(defaults.mcp, configured.mcp);

  return {
    ...defaults,
    ...configured,
    ...(defaults.env || configured.env
      ? { env: { ...defaults.env, ...configured.env } }
      : {}),
    ...(mergedMcp ? { mcp: mergedMcp } : {}),
  };
}

function mergeMcpConfig(
  defaults: McpServerConfig | undefined,
  configured: McpServerConfig | undefined,
): McpServerConfig | undefined {
  if (!defaults && !configured) return undefined;

  const command = configured?.command ?? defaults?.command;
  if (!command) return undefined;

  return {
    command,
    ...(configured?.args ?? defaults?.args ? { args: configured?.args ?? defaults?.args } : {}),
    ...(defaults?.env || configured?.env
      ? { env: { ...defaults?.env, ...configured?.env } }
      : {}),
  };
}
