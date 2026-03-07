import type { WorkflowDef } from "./workflow-types.js";
import { readKeys } from "@/util/keys.js";

export function collectRequiredIntegrations(workflow: WorkflowDef): Set<string> {
  const integrations = new Set<string>();

  for (const step of workflow.steps) {
    if (step.kind !== "prompt" || !step.required_integrations) continue;
    for (const entry of step.required_integrations) {
      for (const name of Object.keys(entry)) {
        integrations.add(name);
      }
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
    if (!entry || Object.keys(entry).length === 0) {
      missing.push(name);
    }
  }

  return { ok: missing.length === 0, missing };
}
