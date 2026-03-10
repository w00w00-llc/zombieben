import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Trigger } from "@/ingestor/trigger.js";
import type { RoleTaggedResponder } from "@/responder/types.js";
import type { TriageOutcome } from "@/triage/types.js";

const setAgentMock = vi.fn();
const syncAllReposMock = vi.fn();
const triageTriggerMock = vi.fn();
const presentOutcomeMock = vi.fn();
const applyOutcomeMock = vi.fn();
const initRunMock = vi.fn();
const sendRunOutcomeMock = vi.fn();
const sendRunMessageMock = vi.fn();
const setLoadingReactionMock = vi.fn();
const markCompletedReactionMock = vi.fn();
const markFailedReactionMock = vi.fn();

vi.mock("@/util/logger.js", () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock("./tick.js", () => ({
  processTick: vi.fn(),
  setAgent: setAgentMock,
}));

vi.mock("@/ingestor/ingestor.js", () => ({
  Ingestor: class {
    constructor(opts: unknown) {
      void opts;
    }
  },
}));

vi.mock("@/ingestor/dedup-store.js", () => ({
  FileDedupStore: class {
    constructor(filePath: string) {
      void filePath;
    }
  },
}));

vi.mock("@/ingestor/channels/index.js", () => ({
  getAllChannels: vi.fn(() => []),
}));

vi.mock("@/triage/triage.js", () => ({
  triageTrigger: triageTriggerMock,
  killActiveTriage: vi.fn(),
}));

vi.mock("@/triage/present.js", () => ({
  presentOutcome: presentOutcomeMock,
}));

vi.mock("@/triage/apply.js", () => ({
  applyOutcome: applyOutcomeMock,
  markRunSuperseded: vi.fn(),
}));

vi.mock("./repo-sync.js", () => ({
  syncAllRepos: syncAllReposMock,
}));

vi.mock("./init-run.js", () => ({
  initRun: initRunMock,
}));

vi.mock("./run-notify.js", () => ({
  sendRunOutcome: sendRunOutcomeMock,
  sendRunMessage: sendRunMessageMock,
}));

vi.mock("./reaction-utils.js", () => ({
  setLoadingReaction: setLoadingReactionMock,
  markCompletedReaction: markCompletedReactionMock,
  markFailedReaction: markFailedReactionMock,
}));

describe("ZombieBenRunner", () => {
  const invokeHandleTrigger = async (
    runner: object,
    trigger: Trigger,
    responders: readonly RoleTaggedResponder[],
    primary?: RoleTaggedResponder,
  ): Promise<void> => {
    const testRunner = runner as {
      handleTrigger: (
        trigger: Trigger,
        responders: readonly RoleTaggedResponder[],
        primary?: RoleTaggedResponder,
      ) => Promise<void>;
    };
    return testRunner.handleTrigger(trigger, responders, primary);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    syncAllReposMock.mockResolvedValue(undefined);
    triageTriggerMock.mockResolvedValue(undefined);
    presentOutcomeMock.mockReset();
    applyOutcomeMock.mockReset();
    initRunMock.mockResolvedValue(undefined);
    sendRunOutcomeMock.mockResolvedValue(undefined);
    sendRunMessageMock.mockResolvedValue(undefined);
    setLoadingReactionMock.mockResolvedValue(undefined);
    markCompletedReactionMock.mockResolvedValue(undefined);
    markFailedReactionMock.mockResolvedValue(undefined);
  });

  it("sends the primary outcome before initRun starts", async () => {
    const outcome: TriageOutcome = {
      kind: "new_workflow",
      resolution: {
        type: "run",
        repoSlug: "org--repo",
        workflowFile: "fix.yml",
        workflowName: "Fix Bug",
        inputs: { issue: "123" },
      },
      reasoning: "run it",
    };
    triageTriggerMock.mockResolvedValue(outcome);
    presentOutcomeMock.mockReturnValue({
      shouldRun: true,
      resolution: {
        repoSlug: "org--repo",
        workflowFile: "fix.yml",
        workflowName: "Fix Bug",
        inputs: { issue: "123" },
      },
    });
    initRunMock.mockResolvedValue({
      repoSlug: "org--repo",
      worktreeId: "wt-1",
      runId: "run-1",
    });

    const responder = {
      send: vi.fn().mockResolvedValue({ id: "m-2" }),
      sendOutcome: vi.fn().mockResolvedValue({ id: "m-1" }),
      edit: vi.fn().mockResolvedValue(undefined),
      react: vi.fn().mockResolvedValue(undefined),
      unreact: vi.fn().mockResolvedValue(undefined),
    };
    const primary: RoleTaggedResponder = {
      channelKey: "slack:C123:1234.5678",
      roles: new Set(["primary"]),
      responder,
    };
    const trigger: Trigger = {
      source: "slack_webhook",
      id: "slack-C123-1234.5678",
      groupKeys: ["slack:C123:1234.5678"],
      timestamp: "2026-03-10T12:00:00.000Z",
      raw_payload: { channel: "C123", ts: "1234.5678", text: "please fix" },
    };

    const { ZombieBenRunner } = await import("./index.js");
    const runner = new ZombieBenRunner({} as never);

    await invokeHandleTrigger(runner, trigger, [primary], primary);

    expect(responder.sendOutcome).toHaveBeenCalledWith(outcome);
    expect(responder.sendOutcome.mock.invocationCallOrder[0]).toBeLessThan(
      initRunMock.mock.invocationCallOrder[0],
    );
    expect(sendRunOutcomeMock).toHaveBeenCalledWith(
      { repoSlug: "org--repo", worktreeId: "wt-1", runId: "run-1" },
      outcome,
      undefined,
      ["slack:C123:1234.5678"],
    );
  });
});
