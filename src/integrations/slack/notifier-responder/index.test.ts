import { describe, it, expect, vi, beforeEach } from "vitest";
import { SlackNotifierResponder, createSlackNotifierResponder } from "./index.js";
import type { TriageOutcome } from "@/triage/types.js";

const mockPostMessage = vi.fn().mockResolvedValue({});

vi.mock("../web-client.js", () => ({
  createSlackWebClient: vi.fn(() => ({
    chat: { postMessage: mockPostMessage },
  })),
}));

vi.mock("../../../util/keys.js", () => ({
  getIntegrationKeys: vi.fn(),
}));

import { getIntegrationKeys } from "@/util/keys.js";
const mockedGetKeys = vi.mocked(getIntegrationKeys);

describe("SlackNotifierResponder", () => {
  const client = { chat: { postMessage: mockPostMessage } } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("send() calls chat.postMessage with channel and text", async () => {
    const responder = new SlackNotifierResponder(client, "C999");
    await responder.send("hello notification");

    expect(mockPostMessage).toHaveBeenCalledWith({
      channel: "C999",
      text: "hello notification",
    });
  });

  it("sendOutcome() posts mrkdwn block payload", async () => {
    const responder = new SlackNotifierResponder(client, "C999");
    const outcome: TriageOutcome = {
      kind: "immediate_response",
      message: "ok",
      reasoning: "test",
    };
    await responder.sendOutcome(outcome);

    expect(mockPostMessage).toHaveBeenCalledWith({
      channel: "C999",
      text: "Triage: immediate_response\nok",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Triage: immediate_response\nok",
          },
        },
      ],
    });
  });

});

describe("createSlackNotifierResponder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no notification_channel is configured", () => {
    mockedGetKeys.mockReturnValue(undefined);
    expect(createSlackNotifierResponder()).toBeNull();
  });

  it("returns null when keys exist but no notification_channel", () => {
    mockedGetKeys.mockReturnValue({ bot_token: "xoxb-123" });
    expect(createSlackNotifierResponder()).toBeNull();
  });

  it("returns channelKey and responder when notification_channel is set", () => {
    mockedGetKeys.mockReturnValue({
      bot_token: "xoxb-123",
      notification_channel: "C999",
    });

    const result = createSlackNotifierResponder();
    expect(result).not.toBeNull();
    expect(result!.channelKey).toBe("slack:C999");
    expect(result!.responder).toBeInstanceOf(SlackNotifierResponder);
  });
});
