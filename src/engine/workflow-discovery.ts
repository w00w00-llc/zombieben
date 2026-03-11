import fs from "node:fs";
import path from "node:path";

export type WorkflowTemplateMap = Record<string, unknown>;

export function discoverWorkflowTemplateMap(rootDir: string): WorkflowTemplateMap {
  const workflows: WorkflowTemplateMap = {};
  if (!fs.existsSync(rootDir)) return workflows;

  walkWorkflowFiles(rootDir, "", workflows);
  return workflows;
}

function walkWorkflowFiles(
  dir: string,
  relativeDir: string,
  workflows: WorkflowTemplateMap,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const nextRelative = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walkWorkflowFiles(fullPath, nextRelative, workflows);
      continue;
    }

    if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) {
      continue;
    }

    const parts = nextRelative.split(path.sep);
    parts[parts.length - 1] = path.basename(parts[parts.length - 1], path.extname(parts[parts.length - 1]));
    setNestedWorkflowValue(workflows, parts, fullPath);
  }
}

function setNestedWorkflowValue(
  workflows: WorkflowTemplateMap,
  parts: string[],
  fullPath: string,
): void {
  let current: WorkflowTemplateMap = workflows;

  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const existing = current[key];
    if (!existing || typeof existing !== "object") {
      current[key] = {};
    }
    current = current[key] as WorkflowTemplateMap;
  }

  current[parts[parts.length - 1]] = fullPath;
}
