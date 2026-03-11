import type { WorkflowDef } from "./workflow-types.js";
import { readKeys } from "@/util/keys.js";
import { getIntegrationConfig } from "@/util/integrations-config.js";

export function collectRequiredIntegrations(workflow: WorkflowDef): Set<string> {
  const integrations = new Set<string>();

  for (const step of workflow.steps) {
    if (step.kind !== "prompt" || !step.required_integrations) continue;
    for (const name of Object.keys(step.required_integrations)) {
      if (name) integrations.add(name);
    }
  }

  return integrations;
}

export interface IntegrationCheckResult {
  ok: boolean;
  missing: string[];
}

export function checkRequiredIntegrations(
  required: Set<string>,
): IntegrationCheckResult {
  if (required.size === 0) return { ok: true, missing: [] };

  const keys = readKeys();
  const missing: string[] = [];

  for (const name of required) {
    const entry = keys[name];
    const config = getIntegrationConfig(name);
    const requiredKeys = config?.required_keys ?? [];
    const hasRequiredKeys = requiredKeys.length === 0
      ? !!entry && Object.keys(entry).length > 0
      : requiredKeys.every((key) => {
          const value = entry?.[key];
          return typeof value === "string" && value.trim() !== "";
        });

    if (!hasRequiredKeys) {
      missing.push(name);
    }
  }

  return { ok: missing.length === 0, missing };
}
