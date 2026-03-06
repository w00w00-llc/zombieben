import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { Trigger } from "@/ingestor/trigger.js";
import type { TriageOutcome } from "./types.js";
import { triageOutcomeJsonSchema } from "./types.js";
import { buildTriagePrompt } from "./prompt.js";
import { reposDir } from "@/util/paths.js";
import { log } from "@/util/logger.js";

const execFile = promisify(execFileCb);

export interface TriageOpts {
  chatCommand?: string;
}

export async function triageTrigger(
  trigger: Trigger,
  opts?: TriageOpts,
): Promise<TriageOutcome> {
  const prompt = buildTriagePrompt(trigger);
  const chatCommand = opts?.chatCommand ?? "claude";

  try {
    const { stdout } = await execFile(
      chatCommand,
      [
        "-p", prompt,
        "--tools", "Read,Glob,Grep",
        "--dangerously-skip-permissions",
        "--add-dir", reposDir(),
        "--print",
        "--output-format", "json",
        "--json-schema", JSON.stringify(triageOutcomeJsonSchema),
      ],
      { maxBuffer: 50 * 1024 * 1024 },
    );

    const parsed = JSON.parse(stdout) as TriageOutcome;
    return parsed;
  } catch (err) {
    log.error(`Triage failed: ${(err as Error).message}`);
    return {
      kind: "immediate_response",
      message: "I'm having trouble processing your request right now. Please try again.",
      reasoning: `Triage invocation failed: ${(err as Error).message}`,
    };
  }
}
