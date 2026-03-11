import type { WorkflowStepDef } from "./workflow-types.js";
import type { McpSpawnConfig } from "@/codingagents/types.js";
import { getIntegrationKeys } from "@/util/keys.js";
import { getIntegrationConfig } from "@/util/integrations-config.js";

export interface ResolvedIntegrations {
  mcpConfigs: Record<string, McpSpawnConfig>;
  env: Record<string, string>;
}

export function resolveIntegrationsForStep(
  step: WorkflowStepDef,
): ResolvedIntegrations {
  const mcpConfigs: Record<string, McpSpawnConfig> = {};
  const env: Record<string, string> = {};

  if (step.kind !== "prompt" || !step.required_integrations) {
    return { mcpConfigs, env };
  }

  for (const name of Object.keys(step.required_integrations)) {
    if (!name) continue;

    const keys = getIntegrationKeys(name);
    const config = getIntegrationConfig(name);

    // Env var fallback: always set if we have an api_key
    if (keys?.api_key) {
      const envVar = config?.env_var ?? `${name.toUpperCase()}_API_KEY`;
      env[envVar] = keys.api_key;
    }

    // MCP config: only if configured
    if (config?.mcp) {
      const resolvedEnv: Record<string, string> = {};
      if (config.mcp.env && keys) {
        for (const [envKey, envVal] of Object.entries(config.mcp.env)) {
          if (envVal.startsWith("$") && keys[envVal.slice(1)]) {
            resolvedEnv[envKey] = keys[envVal.slice(1)];
          } else {
            resolvedEnv[envKey] = envVal;
          }
        }
      }

      mcpConfigs[name] = {
        command: config.mcp.command,
        ...(config.mcp.args ? { args: config.mcp.args } : {}),
        ...(Object.keys(resolvedEnv).length > 0 ? { env: resolvedEnv } : {}),
      };
    }
  }

  return { mcpConfigs, env };
}
