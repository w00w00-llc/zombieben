import path from "node:path";
import type { TriggerResponder } from "@/responder/responder.js";

// --- Template context ---

export interface TemplateContext {
  inputs?: Record<string, unknown>;
  artifacts?: Record<string, string>;
  output_artifacts?: Record<string, string>;
  skills?: Record<string, string>;
  trigger?: Record<string, unknown>;
  triggers?: Record<string, unknown>;
  worktree?: Record<string, unknown>;
  zombieben?: Record<string, unknown>;
  responder?: TriggerResponder;
}

// --- Expression resolution ---

const TEMPLATE_PATTERN = /\$\{\{\s*(.+?)\s*\}\}/g;

/**
 * Resolve all `${{ expr }}` templates in a string.
 * Returns the string with all expressions replaced by their resolved values.
 */
export function resolveTemplate(
  template: string,
  context: TemplateContext
): string {
  return template.replace(TEMPLATE_PATTERN, (_match, expr: string) => {
    return resolveExpression(expr.trim(), context);
  });
}

/**
 * Resolve a single expression like `inputs.prompt` or `artifacts.plan`
 * against the context. Returns the resolved string value, or the original
 * expression wrapped in ${{ }} if unresolvable.
 */
export function resolveExpression(
  expr: string,
  context: TemplateContext
): string {
  const value = getNestedValue(context as unknown as Record<string, unknown>, expr);
  if (value === undefined) {
    return `\${{ ${expr} }}`;
  }
  return String(value);
}

function getNestedValue(obj: Record<string, unknown>, dotPath: string): unknown {
  const parts = dotPath.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current == null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

// --- Output artifact path generation ---

/**
 * Generate the file path for an output artifact.
 * Convention: `{artifactsDir}/{artifact-name}.md`
 */
export function outputArtifactPath(
  artifactsDir: string,
  artifactName: string
): string {
  return path.join(artifactsDir, `${artifactName}.md`);
}

/**
 * Build a TemplateContext with output_artifacts auto-populated
 * from artifact names found in the workflow steps.
 */
export function buildOutputArtifactMap(
  artifactNames: string[],
  artifactsDir: string
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const name of artifactNames) {
    map[name] = outputArtifactPath(artifactsDir, name);
  }
  return map;
}

/**
 * Extract all artifact names referenced as `output_artifacts.{name}`
 * from a template string.
 */
export function extractOutputArtifactNames(template: string): string[] {
  const names = new Set<string>();
  const pattern = /\$\{\{\s*output_artifacts\.(\S+?)\s*\}\}/g;
  let match;
  while ((match = pattern.exec(template)) !== null) {
    names.add(match[1]);
  }
  return [...names];
}
