import type { Logger } from "@/util/logger.js";
import type { PromptStepDef } from "./workflow-types.js";
import type { TemplateContext } from "./workflow-template.js";
import { resolveTemplate } from "./workflow-template.js";

const TRUTHY = new Set(["true", "1", "yes", "on"]);
const FALSY = new Set(["false", "0", "no", "off"]);

export function shouldAwaitApprovalForPrompt(
  step: PromptStepDef,
  context: TemplateContext,
  log?: Logger,
): boolean {
  if (!step.await_approval) return false;

  const raw = step.await_approval.enabled;
  if (typeof raw === "boolean") return raw;

  const resolved = resolveTemplate(String(raw), context).trim().toLowerCase();
  if (TRUTHY.has(resolved)) return true;
  if (FALSY.has(resolved)) return false;

  log?.warn(
    `Invalid await_approval.enabled for step "${step.name || "(unnamed)"}": raw="${String(raw)}", resolved="${resolved}". Defaulting to true.`,
  );
  return true;
}

