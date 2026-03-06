import type { Trigger } from "@/ingestor/trigger.js";
import { reposDir } from "@/util/paths.js";

interface ThreadMessage {
  user: string;
  ts: string;
  text: string;
}

function serializeThreadHistory(trigger: Trigger): string {
  const context = trigger.context as { allThreadMessages?: ThreadMessage[] } | undefined;
  const messages = context?.allThreadMessages;
  if (!messages || messages.length === 0) return "No thread history (this is a top-level message).";

  return messages
    .map((m) => `[${m.ts}] ${m.user}: ${m.text}`)
    .join("\n");
}

function serializeTriggerPayload(trigger: Trigger): string {
  const payload = trigger.raw_payload as Record<string, unknown>;
  const text = (payload?.text as string) ?? JSON.stringify(payload);
  return text;
}

export function buildTriagePrompt(trigger: Trigger): string {
  const repos = reposDir();

  return `You are a trigger triager for ZombieBen, an automated CI/CD bot. A new trigger has arrived and you must decide what to do with it.

## Trigger

- **Source**: ${trigger.source}
- **ID**: ${trigger.id}
- **Group Keys**: ${trigger.groupKeys.join(", ")}
- **Timestamp**: ${trigger.timestamp}
- **Message**: ${serializeTriggerPayload(trigger)}

## Thread History

${serializeThreadHistory(trigger)}

## Your Task

Determine the correct triage outcome for this trigger. You have access to read-only tools (Read, Glob, Grep) to look up context.

### Where to find context

- **Available workflows**: \`${repos}/*/main_repo/.zombieben/workflows/*.yml\`
  Each YAML file defines a workflow with \`name\`, optional \`confirmation_required: true\`, \`inputs\`, and \`steps\`.
- **Active/past runs**: \`${repos}/*/tasks/*/workflow_state.json\`
  Each has \`workflow_name\`, \`status\` (pending/running/awaiting_approval/completed/failed), \`step_index\`, \`step_name\`, \`created_at\`.
- **Trigger history per run**: \`${repos}/*/tasks/*/trigger.json\`
  Each has \`id\`, \`source\`, and \`groupKeys\` (array of strings). Use \`groupKeys\` to find runs related to this trigger — a run is related if any of its group keys overlap with this trigger's group keys.

### Steps

1. Use Glob to find all workflow YAML files and read them to understand what workflows are available.
2. Use Glob to find all active runs (workflow_state.json files) and their associated trigger.json files.
3. Check if any existing runs share any of this trigger's \`groupKeys\` (${JSON.stringify(trigger.groupKeys)}) — overlapping group keys indicate a related/follow-up trigger.
4. Also check if the message content refers to any active runs (cross-thread follow-up).
5. Based on your analysis, return one of the three outcome types below.

### Outcome Types

**1. \`new_workflow\`** — This is a request to start a new workflow.

Sub-resolution decision tree:
- If you match to a single workflow with **high confidence** AND the workflow does NOT have \`confirmation_required: true\` → use \`type: "run"\`
- If you match to a single workflow with **high confidence** AND the workflow has \`confirmation_required: true\` → use \`type: "confirm"\`
  - Exception: if this workflow was previously suggested to the user in the thread history and they are now confirming it, use \`type: "run"\` instead
- If you match to a single workflow with **low confidence** → use \`type: "suggest"\` with just that one workflow
- If multiple workflows could match → use \`type: "suggest"\` with all candidates

**2. \`in_progress_workflow_adjustment\`** — This trigger is a follow-up to an existing active run.

Identify the related run and choose an action:
- \`rollback_to_step\`: User wants to redo from a specific step
- \`pause\`: User wants to pause the workflow
- \`resume\`: User wants to resume a paused/awaiting_approval workflow
- \`cancel\`: User wants to stop the workflow
- \`adjust\`: User wants to modify the current approach (include their instruction)
- \`status_check\`: User is asking about progress

**3. \`immediate_response\`** — Not a workflow request. Respond directly.

Use for: "thanks", status questions with no active runs, chitchat, simple questions about ZombieBen itself.

### Output Format

Return a JSON object matching exactly one of these shapes:

\`\`\`json
{
  "kind": "new_workflow",
  "resolution": {
    "type": "run",
    "repoSlug": "my-repo",
    "workflowFile": "implement.yml",
    "workflowName": "Implement Feature",
    "inputs": { "task_id": "TASK-1234" }
  },
  "reasoning": "User requested implementation of TASK-1234, matched to implement.yml with high confidence."
}
\`\`\`

\`\`\`json
{
  "kind": "in_progress_workflow_adjustment",
  "relatedRun": { "repoSlug": "my-repo", "worktreeId": "implement-feature-1234567890" },
  "action": { "type": "adjust", "instruction": "Make the colors less red" },
  "reasoning": "User is in the same thread as an active run and is providing feedback."
}
\`\`\`

\`\`\`json
{
  "kind": "immediate_response",
  "message": "You're welcome! Let me know if you need anything else.",
  "reasoning": "User said thanks — no workflow action needed."
}
\`\`\`
`;
}
