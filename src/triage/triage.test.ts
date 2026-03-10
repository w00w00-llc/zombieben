import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Trigger } from "@/ingestor/trigger.js";
import type { TriageOutcome } from "./types.js";
import type { CodingAgent, CodingAgentHandle } from "@/codingagents/index.js";

vi.mock("../util/paths.js", () => ({
  reposDir: () => "/home/test/.zombieben/repos",
}));

vi.mock("../util/logger.js", () => ({
  log: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { triageTrigger } from "./triage.js";

function makeTrigger(): Trigger {
  return {
    source: "slack_webhook",
    id: "slack-C123-1234.5678",
    groupKeys: ["slack:C123:1234.5678"],
    timestamp: "2026-03-05T00:00:00Z",
    raw_payload: { channel: "C123", ts: "1234.5678", user: "U456", text: "implement TASK-1234" },
  };
}

function envelope(result: unknown): string {
  // Simulate stream-json: preceding events then the result line
  const lines = [
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "thinking..." }] } }),
    JSON.stringify({ type: "result", result: JSON.stringify(result), is_error: false }),
  ];
  return lines.join("\n");
}

function mockAgent(handle: CodingAgentHandle): CodingAgent {
  return { spawn: vi.fn().mockReturnValue(handle) };
}

function mockSuccess(stdout: string, stderr = ""): CodingAgent {
  return mockAgent({
    done: Promise.resolve({ stdout, stderr }),
    kill: vi.fn(),
  });
}

function mockFailure(message: string): CodingAgent {
  return mockAgent({
    done: Promise.reject(new Error(message)),
    kill: vi.fn(),
  });
}

describe("triageTrigger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses a new_workflow run result from stdout", async () => {
    const expected: TriageOutcome = {
      kind: "new_workflow",
      resolution: {
        type: "run",
        repoSlug: "my-repo",
        workflowFile: "implement.yml",
        workflowName: "Implement Feature",
        inputs: { task_id: "TASK-1234" },
      },
      reasoning: "Matched implement.yml.",
    };
    const agent = mockSuccess(envelope(expected));

    const result = await triageTrigger(makeTrigger(), { agent });
    expect(result).toEqual(expected);
  });

  it("parses an in_progress_workflow_adjustment result", async () => {
    const expected: TriageOutcome = {
      kind: "in_progress_workflow_adjustment",
      relatedRun: { repoSlug: "my-repo", worktreeId: "implement-feature-123", runId: "implement-feature-123" },
      action: { type: "adjust", instruction: "Make it less red" },
      reasoning: "Follow-up in same thread.",
    };
    const agent = mockSuccess(envelope(expected));

    const result = await triageTrigger(makeTrigger(), { agent });
    expect(result).toEqual(expected);
  });

  it("parses retry_fresh adjustment", async () => {
    const expected: TriageOutcome = {
      kind: "in_progress_workflow_adjustment",
      relatedRun: { repoSlug: "my-repo", worktreeId: "wt-1", runId: "run-1" },
      action: { type: "retry_fresh", inputsOverride: { issue: "123" } },
      reasoning: "Retrying failed run from scratch.",
    };
    const agent = mockSuccess(envelope(expected));

    const result = await triageTrigger(makeTrigger(), { agent });
    expect(result).toEqual(expected);
  });

  it("parses an immediate_response result", async () => {
    const expected: TriageOutcome = {
      kind: "immediate_response",
      message: "You're welcome!",
      reasoning: "User said thanks.",
    };
    const agent = mockSuccess(envelope(expected));

    const result = await triageTrigger(makeTrigger(), { agent });
    expect(result).toEqual(expected);
  });

  it("returns fallback when coding agent invocation fails", async () => {
    const agent = mockFailure("Command not found");

    const result = await triageTrigger(makeTrigger(), { agent });
    expect(result.kind).toBe("immediate_response");
    expect((result as { reasoning: string }).reasoning).toContain("Command not found");
  });

  it("returns fallback when stdout is empty", async () => {
    const agent = mockSuccess("");

    const result = await triageTrigger(makeTrigger(), { agent });
    expect(result.kind).toBe("immediate_response");
    expect((result as { reasoning: string }).reasoning).toContain("no output");
  });

  it("returns fallback when stdout is not valid JSON", async () => {
    const agent = mockSuccess("not json at all");

    const result = await triageTrigger(makeTrigger(), { agent });
    expect(result.kind).toBe("immediate_response");
    expect((result as { reasoning: string }).reasoning).toContain("Could not find result in coding agent stream");
  });

  it("returns fallback when coding agent reports an error", async () => {
    const agent = mockSuccess(JSON.stringify({ type: "result", result: "Something went wrong", is_error: true }));

    const result = await triageTrigger(makeTrigger(), { agent });
    expect(result.kind).toBe("immediate_response");
    expect((result as { reasoning: string }).reasoning).toContain("Coding agent returned error");
  });

  it("supports stream lines without a type=result envelope", async () => {
    const expected: TriageOutcome = {
      kind: "immediate_response",
      message: "ok",
      reasoning: "parsed from output_text",
    };
    const stdout = [
      JSON.stringify({ type: "progress", message: "thinking" }),
      JSON.stringify({ type: "final", output_text: JSON.stringify(expected) }),
    ].join("\n");
    const agent = mockSuccess(stdout);

    const result = await triageTrigger(makeTrigger(), { agent });
    expect(result).toEqual(expected);
  });

  it("parses codex-style nested event content after thread.started", async () => {
    const expected: TriageOutcome = {
      kind: "immediate_response",
      message: "codex parsed",
      reasoning: "nested output_text",
    };
    const stdout = [
      JSON.stringify({ type: "thread.started", thread_id: "abc123" }),
      JSON.stringify({
        type: "response.completed",
        response: {
          output: [
            {
              type: "message",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify(expected),
                },
              ],
            },
          ],
        },
      }),
    ].join("\n");
    const agent = mockSuccess(stdout);

    const result = await triageTrigger(makeTrigger(), { agent });
    expect(result).toEqual(expected);
  });

  it("treats plain text response as immediate_response", async () => {
    const agent = mockSuccess(JSON.stringify({ type: "result", result: "No active workflows found.", is_error: false }));

    const result = await triageTrigger(makeTrigger(), { agent });
    expect(result.kind).toBe("immediate_response");
    expect((result as { message: string }).message).toBe("No active workflows found.");
    expect((result as { reasoning: string }).reasoning).toContain("plain text");
  });

  it("strips markdown code fences from response", async () => {
    const inner: TriageOutcome = { kind: "immediate_response", message: "hi", reasoning: "test" };
    const fenced = "```json\n" + JSON.stringify(inner) + "\n```";
    const agent = mockSuccess(JSON.stringify({ type: "result", result: fenced, is_error: false }));

    const result = await triageTrigger(makeTrigger(), { agent });
    expect(result).toEqual(inner);
  });

  it("passes correct options to agent.spawn", async () => {
    const expected: TriageOutcome = { kind: "immediate_response", message: "hi", reasoning: "test" };
    const agent = mockSuccess(envelope(expected));

    await triageTrigger(makeTrigger(), { agent });

    expect(agent.spawn).toHaveBeenCalledOnce();
    const opts = (agent.spawn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(opts.readonly).toBe(true);
    expect(opts.outputFormat).toBe("stream-json");
    expect(opts.addDirs[0]).toBe("/home/test/.zombieben/repos");
    expect(opts.addDirs).toHaveLength(2);
    expect(opts.systemPrompt).toBeDefined();
    expect(opts.prompt).toBeDefined();
  });
});
