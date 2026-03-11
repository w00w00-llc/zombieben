import type { TriggerResponder } from "@/responder/responder.js";

// --- Template context ---

export interface TemplateContext {
  inputs?: Record<string, unknown>;
  artifacts?: Record<string, string>;
  skills?: Record<string, string>;
  workflows?: Record<string, unknown>;
  worktree_metadata?: Record<string, unknown>;
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
  // Rewrite output_artifacts.X → artifacts.X (collapsed namespace)
  if (expr.startsWith("output_artifacts.")) {
    expr = expr.replace("output_artifacts.", "artifacts.");
  }
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

// --- Artifact reference extraction ---

/**
 * Extract all artifact names referenced as `artifacts.X` or `output_artifacts.X`
 * from a template string.
 */
export function extractArtifactNames(template: string): string[] {
  const names = new Set<string>();
  const pattern = /\$\{\{\s*(?:output_)?artifacts\.(\S+?)\s*\}\}/g;
  let match;
  while ((match = pattern.exec(template)) !== null) {
    names.add(match[1]);
  }
  return [...names];
}
