import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Trigger } from "@/ingestor/trigger.js";
import type { TriageOutcome } from "./types.js";

vi.mock("../util/paths.js", () => ({
  reposDir: () => "/home/test/.zombieben/repos",
}));

vi.mock("../util/logger.js", () => ({
  log: { info: vi.fn(), error: vi.fn() },
}));

const mockExecFile = vi.hoisted(() => vi.fn());
vi.mock("node:util", () => ({
  promisify: () => mockExecFile,
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
    mockExecFile.mockResolvedValue({ stdout: JSON.stringify(expected) });

    const result = await triageTrigger(makeTrigger());

    expect(result).toEqual(expected);
  });

  it("parses an in_progress_workflow_adjustment result", async () => {
    const expected: TriageOutcome = {
      kind: "in_progress_workflow_adjustment",
      relatedRun: { repoSlug: "my-repo", worktreeId: "implement-feature-123" },
      action: { type: "adjust", instruction: "Make it less red" },
      reasoning: "Follow-up in same thread.",
    };
    mockExecFile.mockResolvedValue({ stdout: JSON.stringify(expected) });

    const result = await triageTrigger(makeTrigger());

    expect(result).toEqual(expected);
  });

  it("parses an immediate_response result", async () => {
    const expected: TriageOutcome = {
      kind: "immediate_response",
      message: "You're welcome!",
      reasoning: "User said thanks.",
    };
    mockExecFile.mockResolvedValue({ stdout: JSON.stringify(expected) });

    const result = await triageTrigger(makeTrigger());

    expect(result).toEqual(expected);
  });

  it("returns fallback immediate_response when claude invocation fails", async () => {
    mockExecFile.mockRejectedValue(new Error("Command not found"));

    const result = await triageTrigger(makeTrigger());

    expect(result.kind).toBe("immediate_response");
    expect((result as { message: string }).message).toContain("having trouble");
  });

  it("returns fallback when stdout is not valid JSON", async () => {
    mockExecFile.mockResolvedValue({ stdout: "not json" });

    const result = await triageTrigger(makeTrigger());

    expect(result.kind).toBe("immediate_response");
  });

  it("passes correct flags to claude", async () => {
    const expected: TriageOutcome = {
      kind: "immediate_response",
      message: "hi",
      reasoning: "test",
    };
    mockExecFile.mockResolvedValue({ stdout: JSON.stringify(expected) });

    await triageTrigger(makeTrigger());

    expect(mockExecFile).toHaveBeenCalledOnce();
    const [cmd, args] = mockExecFile.mock.calls[0];
    expect(cmd).toBe("claude");
    expect(args).toContain("--tools");
    expect(args).toContain("Read,Glob,Grep");
    expect(args).toContain("--output-format");
    expect(args).toContain("json");
    expect(args).toContain("--print");
    expect(args).toContain("--dangerously-skip-permissions");
  });

  it("uses custom chatCommand when provided", async () => {
    const expected: TriageOutcome = {
      kind: "immediate_response",
      message: "hi",
      reasoning: "test",
    };
    mockExecFile.mockResolvedValue({ stdout: JSON.stringify(expected) });

    await triageTrigger(makeTrigger(), { chatCommand: "/usr/local/bin/claude" });

    const [cmd] = mockExecFile.mock.calls[0];
    expect(cmd).toBe("/usr/local/bin/claude");
  });
});
