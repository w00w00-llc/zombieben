import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TriggerResponder } from "@/responder/responder.js";

const loadRunRespondersSnapshotMock = vi.fn();
const instantiateRunRespondersMock = vi.fn();

vi.mock("@/responder/run-responders.js", () => ({
  loadRunRespondersSnapshot: loadRunRespondersSnapshotMock,
  instantiateRunResponders: instantiateRunRespondersMock,
}));

describe("sendRunMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards attachment options to instantiated responders", async () => {
    const responder: TriggerResponder = {
      send: vi.fn().mockResolvedValue({ id: "msg-1" }),
      sendOutcome: vi.fn().mockResolvedValue({ id: "msg-2" }),
      edit: vi.fn().mockResolvedValue(undefined),
      react: vi.fn().mockResolvedValue(undefined),
      unreact: vi.fn().mockResolvedValue(undefined),
    };

    loadRunRespondersSnapshotMock.mockReturnValue({ entries: [] });
    instantiateRunRespondersMock.mockReturnValue([
      {
        channelKey: "slack:C123",
        roles: new Set(["primary"]),
        responder,
      },
    ]);

    const { sendRunMessage } = await import("./run-notify.js");
    await sendRunMessage(
      { repoSlug: "org--repo", worktreeId: "wt-1", runId: "run-1" },
      "Awaiting approval",
      undefined,
      { attachments: ["/tmp/plan.md", "/tmp/spec.md"] },
    );

    expect(responder.send).toHaveBeenCalledWith("Awaiting approval", {
      attachments: ["/tmp/plan.md", "/tmp/spec.md"],
    });
  });

  it("forwards attachment options to fallback responder when no snapshot exists", async () => {
    const fallback: TriggerResponder = {
      send: vi.fn().mockResolvedValue({ id: "msg-1" }),
      sendOutcome: vi.fn().mockResolvedValue({ id: "msg-2" }),
      edit: vi.fn().mockResolvedValue(undefined),
      react: vi.fn().mockResolvedValue(undefined),
      unreact: vi.fn().mockResolvedValue(undefined),
    };

    loadRunRespondersSnapshotMock.mockReturnValue(null);

    const { sendRunMessage } = await import("./run-notify.js");
    await sendRunMessage(
      { repoSlug: "org--repo", worktreeId: "wt-1", runId: "run-1" },
      "Awaiting approval",
      fallback,
      { attachments: ["/tmp/plan.md"] },
    );

    expect(fallback.send).toHaveBeenCalledWith("Awaiting approval", {
      attachments: ["/tmp/plan.md"],
    });
  });
});
