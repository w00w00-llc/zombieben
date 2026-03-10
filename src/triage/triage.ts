import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Trigger } from "@/ingestor/trigger.js";
import type { TriageOutcome } from "./types.js";
import { buildTriageSystemPrompt, buildTriagePrompt } from "./prompt.js";
import { reposDir } from "@/util/paths.js";
import { log } from "@/util/logger.js";
import type { CodingAgent, CodingAgentHandle } from "@/codingagents/index.js";

export interface TriageOpts {
  agent: CodingAgent;
}

const activeHandles = new Set<CodingAgentHandle>();
const TRIAGE_KINDS = new Set([
  "new_workflow",
  "in_progress_workflow_adjustment",
  "immediate_response",
]);

export function killActiveTriage(): void {
  for (const handle of activeHandles) {
    handle.kill();
  }
  activeHandles.clear();
}

function fallback(reason: string): TriageOutcome {
  log.error(`Triage failed: ${reason}`);
  return {
    kind: "immediate_response",
    message:
      "I'm having trouble processing your request right now. Please try again.",
    reasoning: `Triage invocation failed: ${reason}`,
  };
}

function parseOutcome(raw: unknown): TriageOutcome {
  if (typeof raw === "object" && raw !== null) {
    return raw as TriageOutcome;
  }
  let text = String(raw).trim();

  // Strip markdown code fences
  const fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  try {
    return JSON.parse(text) as TriageOutcome;
  } catch {
    // Last resort: extract first JSON object from surrounding text
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) {
      return JSON.parse(objMatch[0]) as TriageOutcome;
    }
    throw new Error(`No JSON found in response: ${text.slice(0, 200)}`);
  }
}

function findOutcomeObjectDeep(value: unknown): TriageOutcome | undefined {
  if (!value || typeof value !== "object") return undefined;

  if (!Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const kind = record.kind;
    if (typeof kind === "string" && TRIAGE_KINDS.has(kind)) {
      return record as unknown as TriageOutcome;
    }
    for (const child of Object.values(record)) {
      const found = findOutcomeObjectDeep(child);
      if (found) return found;
    }
    return undefined;
  }

  for (const child of value) {
    const found = findOutcomeObjectDeep(child);
    if (found) return found;
  }
  return undefined;
}

function collectTextCandidatesDeep(value: unknown, out: string[]): void {
  if (!value || typeof value !== "object") return;

  if (Array.isArray(value)) {
    for (const item of value) collectTextCandidatesDeep(item, out);
    return;
  }

  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if (
      typeof child === "string" &&
      (key === "output_text" || key === "text" || key === "result" || key === "delta")
    ) {
      out.push(child);
    } else {
      collectTextCandidatesDeep(child, out);
    }
  }
}

function tryParseOutcomeFromJsonLine(line: string): TriageOutcome | undefined {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const deepOutcome = findOutcomeObjectDeep(parsed);
  if (deepOutcome) return deepOutcome;

  const candidates: unknown[] = [];
  if ("structured_output" in parsed) candidates.push(parsed.structured_output);
  if ("result" in parsed) candidates.push(parsed.result);
  if ("output_text" in parsed) candidates.push(parsed.output_text);
  for (const candidate of candidates) {
    try {
      return parseOutcome(candidate);
    } catch {
      // try next candidate
    }
  }

  return undefined;
}

export async function triageTrigger(
  trigger: Trigger,
  opts: TriageOpts,
): Promise<TriageOutcome> {
  const systemPrompt = buildTriageSystemPrompt();
  const prompt = buildTriagePrompt(trigger);

  const start = Date.now();
  log.info(`Invoking coding agent for triage (trigger ${trigger.id})...`);
  const triageCodeRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

  // Write prompts to temp files for manual debugging
  const debugDir = join(tmpdir(), "zombieben-triage");
  mkdirSync(debugDir, { recursive: true });
  const systemPromptPath = join(debugDir, `debug-system-prompt-${trigger.id}.txt`);
  const promptPath = join(debugDir, `debug-prompt-${trigger.id}.txt`);
  writeFileSync(systemPromptPath, systemPrompt);
  writeFileSync(promptPath, prompt);
  log.debug(`Triage debug prompt: ${promptPath}`);
  log.debug(`Triage debug system prompt: ${systemPromptPath}`);

  const handle = opts.agent.spawn({
    prompt,
    systemPrompt,
    readonly: true,
    addDirs: [reposDir(), triageCodeRoot],
    outputFormat: "stream-json",
    log,
  });

  activeHandles.add(handle);
  let stdout: string;
  let stderr: string;
  try {
    ({ stdout, stderr } = await handle.done);
  } catch (err) {
    return fallback(
      `${(err as Error).message} (after ${Math.round((Date.now() - start) / 1000)}s)`,
    );
  } finally {
    activeHandles.delete(handle);
  }

  log.info(`Coding agent responded in ${Math.round((Date.now() - start) / 1000)}s`);

  if (!stdout) {
    return fallback(
      `Coding agent produced no output. stderr: ${stderr?.slice(0, 500) ?? "(empty)"}`,
    );
  }

  // stream-json may output one JSON object per line; first prefer an explicit result envelope.
  let envelope: Record<string, unknown> | undefined;
  for (const line of stdout.split("\n").reverse()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (parsed.type === "result") {
        envelope = parsed;
        break;
      }
    } catch {
      // skip non-JSON lines
    }
  }

  if (!envelope) {
    // Fallback path for agents that emit different JSON envelopes.
    const textCandidates: string[] = [];
    for (const line of stdout.split("\n").reverse()) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parsed = tryParseOutcomeFromJsonLine(trimmed);
      if (parsed) return parsed;
      try {
        const lineObj = JSON.parse(trimmed) as unknown;
        collectTextCandidatesDeep(lineObj, textCandidates);
      } catch {
        // ignore non-JSON lines
      }
    }

    if (textCandidates.length > 0) {
      const joined = textCandidates.join("\n");
      try {
        return parseOutcome(joined);
      } catch {
        // fall through to final fallback
      }
    }

    return fallback(
      `Could not find result in coding agent stream output: ${stdout.slice(0, 200)}`,
    );
  }

  if (envelope.session_id) {
    log.info(`Coding agent session_id: ${String(envelope.session_id)}`);
  }

  if (stderr) {
    log.info(`Triage stderr: ${stderr.slice(0, 500)}`);
  }

  if (envelope.is_error) {
    return fallback(`Coding agent returned error: ${envelope.result}`);
  }

  try {
    return parseOutcome(envelope.structured_output ?? envelope.result);
  } catch {
    // Model responded with plain text instead of JSON — treat as immediate response
    const text = String(envelope.result ?? "").trim();
    return {
      kind: "immediate_response",
      message: text || "I'm not sure how to handle that request.",
      reasoning: "Model returned plain text instead of structured JSON.",
    };
  }
}
