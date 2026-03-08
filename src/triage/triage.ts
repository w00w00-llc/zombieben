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

export async function triageTrigger(
  trigger: Trigger,
  opts: TriageOpts,
): Promise<TriageOutcome> {
  const systemPrompt = buildTriageSystemPrompt();
  const prompt = buildTriagePrompt(trigger);

  const start = Date.now();
  log.info(`Invoking claude for triage (trigger ${trigger.id})...`);
  const triageCodeRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

  // Write prompts to temp files for manual debugging
  const debugDir = join(tmpdir(), "zombieben-triage");
  mkdirSync(debugDir, { recursive: true });
  const systemPromptPath = join(debugDir, `debug-system-prompt-${trigger.id}.txt`);
  const promptPath = join(debugDir, `debug-prompt-${trigger.id}.txt`);
  writeFileSync(systemPromptPath, systemPrompt);
  writeFileSync(promptPath, prompt);
  log.debug(`Test the triage prompt by running: cat ${promptPath} | claude -p - --verbose --system-prompt "$(cat ${systemPromptPath})" --tools Read,Glob,Grep --dangerously-skip-permissions --add-dir ${reposDir()} --add-dir ${triageCodeRoot} --output-format stream-json`);

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

  log.info(`Claude responded in ${Math.round((Date.now() - start) / 1000)}s`);

  if (!stdout) {
    return fallback(
      `Claude produced no output. stderr: ${stderr?.slice(0, 500) ?? "(empty)"}`,
    );
  }

  // stream-json outputs one JSON object per line; find the result line
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
    return fallback(
      `Could not find result in claude stream output: ${stdout.slice(0, 200)}`,
    );
  }

  if (envelope.session_id) {
    log.info(`Claude session_id: ${String(envelope.session_id)}`);
  }

  if (stderr) {
    log.info(`Triage stderr: ${stderr.slice(0, 500)}`);
  }

  if (envelope.is_error) {
    return fallback(`Claude returned error: ${envelope.result}`);
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
